/* The Vivo session gate. When a Vivo base URL is configured, the app will not
   boot past this point without a valid surface ticket: restore a stored
   session or render a sign-in card and wait. Without configuration this is a
   no-op and the app behaves exactly like upstream. */

import { buttonMarkup } from "../../core/html/markup.js";
import { VivoAuth } from "./auth.js";
import { vivoBaseUrl, vivoEnabled } from "./config.js";

const GATE_STYLES = `
.vivo-gate { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg, #faf7f0); z-index: 999; }
.vivo-gate-card { width: min(360px, calc(100vw - 48px)); padding: 28px; border-radius: 16px; background: var(--surface, #fff); box-shadow: 0 12px 40px rgba(20,18,12,.12); font: 15px/1.5 system-ui, sans-serif; }
.vivo-gate-card h1 { margin: 0 0 4px; font-size: 19px; }
.vivo-gate-card p { margin: 0 0 16px; color: #6b6558; font-size: 13px; }
.vivo-gate-card label { display: block; margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: #4a463c; }
.vivo-gate-card input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #d8d2c4; border-radius: 10px; font-size: 14px; background: inherit; color: inherit; }
.vivo-gate-card .vivo-gate-submit { width: 100%; margin-top: 16px; padding: 10px 14px; border: 0; border-radius: 10px; background: #14120c; color: #faf7f0; font-size: 14px; font-weight: 650; cursor: pointer; }
.vivo-gate-card .vivo-gate-submit[disabled] { opacity: .6; cursor: default; }
.vivo-gate-error { min-height: 18px; margin-top: 10px; color: #a33d2a; font-size: 12px; }
`;

/**
 * @returns {Promise<{ticket: string, email: string, auth: VivoAuth} | null>}
 *   null when Vivo is not configured (vanilla upstream behavior).
 */
export async function requireVivoSession() {
  if (!vivoEnabled()) return null;
  const auth = new VivoAuth(vivoBaseUrl());
  const restored = await auth.restore();
  if (restored) return { ...restored, auth };
  const activation = await promptSignIn(auth);
  return { ...activation, auth };
}

/** @param {VivoAuth} auth */
function promptSignIn(auth) {
  return new Promise((resolve) => {
    const style = document.createElement("style");
    style.textContent = GATE_STYLES;
    const gate = document.createElement("div");
    gate.className = "vivo-gate";
    gate.innerHTML = `
      <form class="vivo-gate-card">
        <h1>Vivo canvas</h1>
        <p>Sign in with the same email and password as the iPhone.</p>
        <label for="vivo-gate-email">Email</label>
        <input id="vivo-gate-email" type="email" autocomplete="username" required />
        <label for="vivo-gate-password">Password</label>
        <input id="vivo-gate-password" type="password" autocomplete="current-password" required />
        <div class="vivo-gate-error" role="alert" aria-live="polite"></div>
        ${buttonMarkup({ bare: true, id: "vivo-gate-submit", className: "vivo-gate-submit", label: "Sign in" })}
      </form>`;
    document.head.appendChild(style);
    document.body.appendChild(gate);
    const form = gate.querySelector("form");
    const errorEl = gate.querySelector(".vivo-gate-error");
    const button = /** @type {HTMLButtonElement} */ (gate.querySelector("#vivo-gate-submit"));
    button.addEventListener("click", () => form.requestSubmit());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = /** @type {HTMLInputElement} */ (gate.querySelector("#vivo-gate-email")).value.trim();
      const password = /** @type {HTMLInputElement} */ (gate.querySelector("#vivo-gate-password")).value;
      if (!email || !password) return;
      button.disabled = true;
      errorEl.textContent = "";
      auth.signIn(email, password).then((activation) => {
        gate.remove();
        style.remove();
        resolve(activation);
      }).catch((err) => {
        button.disabled = false;
        errorEl.textContent = err?.message || "Sign-in failed. Try again.";
      });
    });
    /** @type {HTMLInputElement} */ (gate.querySelector("#vivo-gate-email")).focus();
  });
}

/** Stable per-user IndexedDB name so accounts on one browser stay separate. */
export function vivoStoreDbName(email) {
  const normalized = email.trim().toLocaleLowerCase();
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(index)) >>> 0;
  }
  return `rabbithole-vivo-${hash.toString(36)}`;
}
