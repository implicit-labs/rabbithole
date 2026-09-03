/* Vivo integration configuration, baked at build time (see build.mjs):
   - VIVO_BASE_URL: origin the Vivo APIs live on. Empty means SAME ORIGIN,
     used when the build is embedded inside the Vivo web app.
   - VIVO_BASE_PATH: the path the SPA is mounted under (e.g. /debug/rabbithole)
     when embedded; empty means it owns the root.
   - VIVO_EMBEDDED: "1" when this build is served inside the Vivo web app, so
     the Vivo surface is enabled even though the API base is same-origin, and
     the host's Supabase session is reused instead of a second sign-in.
   A "rh-vivo-base" localStorage override still points a standalone dev build at
   a chosen server. With none of these the app behaves exactly like upstream. */

const BASE_OVERRIDE_KEY = "rh-vivo-base";

function baked(name) {
  // eslint-disable-next-line no-undef
  if (name === "url") return typeof __VIVO_BASE_URL__ === "string" ? __VIVO_BASE_URL__ : "";
  // eslint-disable-next-line no-undef
  if (name === "path") return typeof __VIVO_BASE_PATH__ === "string" ? __VIVO_BASE_PATH__ : "";
  // eslint-disable-next-line no-undef
  return typeof __VIVO_EMBEDDED__ === "string" ? __VIVO_EMBEDDED__ : "";
}

/** True when this build is served inside the Vivo web app (same origin). */
export function vivoEmbedded() {
  return baked("embedded") === "1";
}

/** API origin. Empty string means same-origin (embedded). */
export function vivoBaseUrl() {
  let override = "";
  try {
    override = localStorage.getItem(BASE_OVERRIDE_KEY) || "";
  } catch {
    // Storage can be blocked; the baked value still applies.
  }
  const value = override.trim() || baked("url").trim();
  return value.replace(/\/+$/, "");
}

/** SPA mount path (no trailing slash), or "" when the app owns the root. */
export function vivoBasePath() {
  return baked("path").trim().replace(/\/+$/, "");
}

export function vivoEnabled() {
  return vivoEmbedded() || vivoBaseUrl() !== "";
}
