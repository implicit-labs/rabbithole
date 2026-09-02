/* Vivo integration configuration. The base URL is baked at build time via the
   VIVO_BASE_URL environment variable (see build.mjs); a localStorage override
   ("rh-vivo-base") exists for development against local or staging servers.
   With neither present the whole Vivo surface is disabled and the app behaves
   exactly like upstream Rabbithole. */

const BASE_OVERRIDE_KEY = "rh-vivo-base";

export function vivoBaseUrl() {
  let override = "";
  try {
    override = localStorage.getItem(BASE_OVERRIDE_KEY) || "";
  } catch {
    // Storage can be blocked; the baked value still applies.
  }
  // eslint-disable-next-line no-undef
  const baked = typeof __VIVO_BASE_URL__ === "string" ? __VIVO_BASE_URL__ : "";
  const value = override.trim() || baked.trim();
  return value.replace(/\/+$/, "");
}

export function vivoEnabled() {
  return vivoBaseUrl() !== "";
}
