/** @type {Readonly<Record<PropertyKey, { label: string, q: string }>>} */
export const LENSES = Object.freeze({
  explain: Object.freeze({
    label: "Explain",
    q: "Explain this clearly and precisely: what it means here, why it matters, and the key intuition an expert would want me to take away.",
  }),
  eli5: Object.freeze({
    label: "ELI5",
    q: "Explain this like I'm five: start with a concrete everyday analogy, then translate the analogy back to the real thing, one level more precise.",
  }),
  example: Object.freeze({
    label: "Example",
    q: "Show this in action with one concrete worked example: realistic, minimal, step by step. Use runnable code if it's code-shaped, real numbers if it's quantitative.",
  }),
  deeper: Object.freeze({
    label: "Go Deeper",
    q: "Go one level deeper than this document does: the underlying mechanism, the important edge cases, and what experts know about this that introductory treatments gloss over.",
  }),
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
