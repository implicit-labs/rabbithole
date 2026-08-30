export const ASK_PRESET_KEYS = Object.freeze(["explain", "eli5", "example", "deeper"]);

/*
 * Default instructions are deliberately minimal: the model already sees the
 * selection and the document, so a preset only needs to name the move. Anyone
 * who wants a more opinionated instruction edits the preset in Settings.
 */
/** @type {Readonly<Record<PropertyKey, { label: string, instruction: string }>>} */
export const LENSES = Object.freeze({
  explain: Object.freeze({ label: "Explain", instruction: "Explain this further." }),
  eli5: Object.freeze({ label: "ELI5", instruction: "Explain like I'm five." }),
  example: Object.freeze({ label: "Example", instruction: "Give a concrete example." }),
  deeper: Object.freeze({ label: "Go deeper", instruction: "Go one level deeper." }),
});

export const DEFAULT_ASK_PRESETS = Object.freeze({
  selection: LENSES,
  followup: LENSES,
});

/** @param {unknown} value @param {number} length */
export function truncate(value, length) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

/** @param {PropertyKey} key */
export function lensLabel(key) {
  return LENSES[key] ? LENSES[key].label : String(key || "");
}

/** @param {unknown} lens */
export function normalizeLens(lens) {
  const key = String(lens ?? "").trim();
  return Object.prototype.hasOwnProperty.call(LENSES, key) ? key : null;
}
