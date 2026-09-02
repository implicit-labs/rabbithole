/* Vivo authentication: Supabase password sign-in against the Vivo web app's
   auth endpoints, exchanged for a signed surface ticket. Mirrors the contract
   of the Vivo web surface's own browser auth: the ticket is the only tenant
   selector the APIs accept, tokens live in sessionStorage, and a transient
   failure keeps the stored session so the next restore can retry. */

const SESSION_KEY = "rh-vivo-session";
const REFRESH_MARGIN_MS = 90_000;

export class VivoAuthRejectedError extends Error {}

export class VivoAuth {
  /** @param {string} baseUrl @param {any} [fetchImpl] @param {any} [storage] @param {() => number} [now] */
  constructor(baseUrl, fetchImpl = globalThis.fetch.bind(globalThis), storage = globalThis.sessionStorage, now = Date.now) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.now = now;
  }

  /** @returns {Promise<{ticket: string, email: string} | null>} */
  async restore() {
    const stored = this.readStored();
    if (!stored) return null;
    try {
      const session = stored.expiresAt <= this.now() + REFRESH_MARGIN_MS
        ? await this.token({ refresh_token: stored.refreshToken }, "refresh_token")
        : {
            access_token: stored.accessToken,
            refresh_token: stored.refreshToken,
            expires_in: Math.max(1, Math.floor((stored.expiresAt - this.now()) / 1000)),
            user: { email: stored.email },
          };
      return await this.activate(session);
    } catch (err) {
      if (err instanceof VivoAuthRejectedError) this.storage.removeItem(SESSION_KEY);
      // Transient failures (network, 5xx) keep the session for the next retry.
      return null;
    }
  }

  /** @param {string} email @param {string} password */
  async signIn(email, password) {
    const session = await this.token({ email, password }, "password");
    return this.activate(session);
  }

  signOut() {
    this.storage.removeItem(SESSION_KEY);
  }

  async config() {
    const response = await this.fetchImpl(`${this.baseUrl}/api/auth/supabase/config`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.supabaseUrl || !body.supabaseAnonKey) {
      throw new Error(body?.error || "Vivo auth is not configured on the server");
    }
    return body;
  }

  /** @param {Record<string, string>} payload @param {string} grant */
  async token(payload, grant) {
    const config = await this.config();
    const response = await this.fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: config.supabaseAnonKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.message || "Vivo sign-in failed";
      if ([400, 401, 403].includes(response.status)) throw new VivoAuthRejectedError(message);
      throw new Error(message);
    }
    if (!body?.access_token || !body.refresh_token || typeof body.expires_in !== "number") {
      throw new Error(body?.message || "Vivo sign-in failed");
    }
    return body;
  }

  /** @param {any} session */
  async activate(session) {
    const response = await this.fetchImpl(`${this.baseUrl}/api/auth/supabase`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ticket) {
      if (response.status === 403 && body?.code === "not_invited") {
        throw new VivoAuthRejectedError(`This build is invite-only. Request access with account ID ${body.accountId ?? "unknown"}.`);
      }
      if ([400, 401, 403].includes(response.status)) {
        throw new VivoAuthRejectedError(body?.error || "Could not connect your Vivo account");
      }
      throw new Error(body?.error || "Could not connect your Vivo account");
    }
    const email = session.user?.email ?? "";
    this.storage.setItem(SESSION_KEY, JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: this.now() + session.expires_in * 1000,
      email,
    }));
    return { ticket: body.ticket, email };
  }

  readStored() {
    try {
      const value = JSON.parse(this.storage.getItem(SESSION_KEY) ?? "null");
      return value
        && typeof value.accessToken === "string"
        && typeof value.refreshToken === "string"
        && Number.isFinite(value.expiresAt)
        && typeof value.email === "string"
        ? value
        : null;
    } catch {
      return null;
    }
  }
}
