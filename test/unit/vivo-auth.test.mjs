/** @protects the Vivo session gate: sign-in, ticket exchange, restore, and rejection handling. */
import assert from "node:assert/strict";
import { VivoAuth, VivoAuthRejectedError } from "../../src/web/vivo/auth.js";
import { vivoStoreDbName } from "../../src/web/vivo/gate.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const [pattern, responder] of routes) {
      if (String(url).includes(pattern)) return responder(options);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { impl, calls };
}

const CONFIG = [
  "/api/auth/supabase/config",
  () => jsonResponse(200, { supabaseUrl: "https://sb.test", supabaseAnonKey: "anon" }),
];

// Sign-in: password grant → ticket exchange → session stored.
{
  const storage = memoryStorage();
  const { impl, calls } = fakeFetch([
    CONFIG,
    ["grant_type=password", () => jsonResponse(200, {
      access_token: "at", refresh_token: "rt", expires_in: 3600, user: { email: "t@example.com" },
    })],
    ["/api/auth/supabase", (options) => {
      assert.equal(options.headers.authorization, "Bearer at");
      return jsonResponse(200, { ticket: "tick-1" });
    }],
  ]);
  const auth = new VivoAuth("https://vivo.test/", impl, storage, () => 1_000);
  const activation = await auth.signIn("t@example.com", "pw");
  assert.deepEqual(activation, { ticket: "tick-1", email: "t@example.com" });
  const stored = JSON.parse(storage.map.get("rh-vivo-session"));
  assert.equal(stored.refreshToken, "rt");
  assert.equal(stored.expiresAt, 1_000 + 3600 * 1000);
  assert.ok(calls.some((call) => call.url === "https://vivo.test/api/auth/supabase"));
}

// Restore with a fresh session: no token refresh, straight to ticket exchange.
{
  const storage = memoryStorage();
  storage.setItem("rh-vivo-session", JSON.stringify({
    accessToken: "at", refreshToken: "rt", expiresAt: 10_000_000, email: "t@example.com",
  }));
  const { impl, calls } = fakeFetch([
    ["/api/auth/supabase", () => jsonResponse(200, { ticket: "tick-2" })],
  ]);
  const auth = new VivoAuth("https://vivo.test", impl, storage, () => 1_000);
  const activation = await auth.restore();
  assert.equal(activation.ticket, "tick-2");
  assert.ok(!calls.some((call) => call.url.includes("grant_type")), "fresh session must not refresh");
}

// Restore with an expired session refreshes through the refresh_token grant.
{
  const storage = memoryStorage();
  storage.setItem("rh-vivo-session", JSON.stringify({
    accessToken: "old", refreshToken: "rt", expiresAt: 500, email: "t@example.com",
  }));
  const { impl } = fakeFetch([
    CONFIG,
    ["grant_type=refresh_token", () => jsonResponse(200, {
      access_token: "new", refresh_token: "rt2", expires_in: 3600, user: { email: "t@example.com" },
    })],
    ["/api/auth/supabase", (options) => {
      assert.equal(options.headers.authorization, "Bearer new");
      return jsonResponse(200, { ticket: "tick-3" });
    }],
  ]);
  const auth = new VivoAuth("https://vivo.test", impl, storage, () => 1_000);
  const activation = await auth.restore();
  assert.equal(activation.ticket, "tick-3");
  assert.equal(JSON.parse(storage.map.get("rh-vivo-session")).accessToken, "new");
}

// A rejected restore clears the stored session; a transient failure keeps it.
{
  const storage = memoryStorage();
  storage.setItem("rh-vivo-session", JSON.stringify({
    accessToken: "at", refreshToken: "rt", expiresAt: 10_000_000, email: "t@example.com",
  }));
  const rejected = new VivoAuth("https://vivo.test", async () => jsonResponse(401, { error: "nope" }), storage, () => 1_000);
  assert.equal(await rejected.restore(), null);
  assert.equal(storage.map.has("rh-vivo-session"), false, "rejection clears the session");

  storage.setItem("rh-vivo-session", JSON.stringify({
    accessToken: "at", refreshToken: "rt", expiresAt: 10_000_000, email: "t@example.com",
  }));
  const transient = new VivoAuth("https://vivo.test", async () => { throw new Error("network down"); }, storage, () => 1_000);
  assert.equal(await transient.restore(), null);
  assert.equal(storage.map.has("rh-vivo-session"), true, "transient failure keeps the session");
}

// Password rejection surfaces as VivoAuthRejectedError with the server message.
{
  const { impl } = fakeFetch([
    CONFIG,
    ["grant_type=password", () => jsonResponse(400, { message: "Invalid login credentials" })],
  ]);
  const auth = new VivoAuth("https://vivo.test", impl, memoryStorage(), () => 1_000);
  await assert.rejects(() => auth.signIn("t@example.com", "bad"), VivoAuthRejectedError);
}

// Per-user database names are stable, distinct, and IndexedDB-safe.
assert.equal(vivoStoreDbName(" T@Example.com "), vivoStoreDbName("t@example.com"));
assert.notEqual(vivoStoreDbName("a@example.com"), vivoStoreDbName("b@example.com"));
assert.match(vivoStoreDbName("t@example.com"), /^rabbithole-vivo-[a-z0-9]+$/);

console.log("ok vivo auth: sign-in, restore, refresh, rejection, per-user store names");
