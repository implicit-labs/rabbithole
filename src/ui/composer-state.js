import { followupCommitFromEnter, isComposingText } from "./input-intent.js";

const LENS_KEYS = { "1": "explain", "2": "eli5", "3": "example", "4": "deeper" };

/**
 * @param {{ text: HTMLTextAreaElement, commits: Iterable<HTMLButtonElement>, lenses?: Iterable<HTMLButtonElement>, wrap: Element }} elements
 * @param {{ phase: "frozen" | "closed" | "away" | "live", pending: boolean }} state
 * @param {{ frozen: string, closed: string, pending: string, away: string, live: string }} copy
 */
export function applyComposerState(elements, state, copy) {
  var down = state.phase === "frozen" || state.phase === "closed" || state.pending;
  elements.text.disabled = down;
  elements.wrap.classList.toggle("disabled", down);
  var placeholderPhase = state.pending && state.phase !== "frozen" && state.phase !== "closed"
    ? "pending" : state.phase;
  elements.text.placeholder = copy[placeholderPhase];
  for (const commit of elements.commits) commit.disabled = down || !elements.text.value.trim();
  for (const lens of elements.lenses || []) lens.disabled = down;
}

// The one interaction contract for every composer surface: commit buttons and
// Enter/⌘Enter act on a draft, lenses (buttons or 1–4 keys) act on an empty
// box only. Callbacks receive the raw event; sources and submit guards stay
// with the mount, as does listener lifetime — pass the mount's scope.listen
// when the surface outlives its module (raw addEventListener otherwise).
/** @param {{ text: HTMLTextAreaElement, actions: Element,
 *   listen?: (target: EventTarget, type: string, handler: (event: any) => void) => void,
 *   onCommit: (kind: string, event: Event) => void,
 *   onLens: (lens: string, event: Event) => void }} surface */
export function wireComposerActions(surface) {
  var listen = surface.listen || function (target, type, handler) { target.addEventListener(type, handler); };
  listen(surface.actions, "click", function (e) {
    var target = /** @type {Element} */ (e.target);
    var button = target.closest ? /** @type {HTMLButtonElement | null} */ (target.closest("button")) : null;
    if (!button || button.disabled) return;
    if (button.dataset.commit && surface.text.value.trim()) surface.onCommit(button.dataset.commit, e);
    else if (button.dataset.lens && surface.text.value === "") surface.onLens(button.dataset.lens, e);
  });
  surface.text.addEventListener("keydown", function (e) {
    var commit = followupCommitFromEnter(e);
    if (commit) { e.preventDefault(); surface.onCommit(commit, e); return; }
    if (!isComposingText(e) && surface.text.value === "" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && LENS_KEYS[e.key]) {
      e.preventDefault();
      surface.onLens(LENS_KEYS[e.key], e);
    }
  });
}
