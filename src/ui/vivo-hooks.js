/* Hooks the live web host installs so produced Vivo unit cards can drive
   server-backed actions (review state, Linear delegation) that need the
   authenticated session. Null in vanilla/frozen builds — the card chrome that
   depends on a hook is simply not rendered there. */

export const vivoHooks = {
  /** @type {((node: any) => void) | null} */
  reviewUnit: null,
};

/** @param {Partial<typeof vivoHooks>} hooks */
export function setVivoHooks(hooks) {
  Object.assign(vivoHooks, hooks);
}

export function clearVivoHooks() {
  vivoHooks.reviewUnit = null;
}
