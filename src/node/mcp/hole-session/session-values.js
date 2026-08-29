/** @param {import("../../../core/contracts/engine.js").HoleNode | undefined} node */
export function rawPdfExtension(node) {
  return /** @type {Record<string, any> | null} */ (node?.source || node?.extensions?.pdf || null);
}

/** @param {import("../../../core/contracts/engine.js").HoleNode | undefined} node */
export function rawOrigin(node) {
  return /** @type {Record<string, any>} */ (node?.origin || {});
}
