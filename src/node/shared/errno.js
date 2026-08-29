/** @param {unknown} error */
export function errorCode(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** @param {unknown} error */
export function errorStatusCode(error) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return undefined;
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}
