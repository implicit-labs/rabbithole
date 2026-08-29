export class HttpGuardError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = "HttpGuardError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isAllowedBrowserOrigin(origin) {
  if (typeof origin !== "string") return false;
  if (origin === "https://rabbithole.ing") return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Enforce the common DNS-rebinding, browser-origin, and optional bearer gate
 * for a loopback HTTP service. Routes that are intentionally public express
 * that by omitting `authorize`; the guard itself never guesses route policy.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {{
 *   allowedHosts: ReadonlySet<string>,
 *   isAllowedOrigin?: (origin: string) => boolean,
 *   requireOrigin?: boolean,
 *   authorize?: (authorization: string | undefined) => boolean,
 *   error?: (message: string, code: string, statusCode: number) => Error
 * }} policy
 */
export function assertHttpRequest(req, {
  allowedHosts,
  isAllowedOrigin = isAllowedBrowserOrigin,
  requireOrigin = false,
  authorize,
  error = (message, code, statusCode) => new HttpGuardError(message, code, statusCode),
}) {
  if (!allowedHosts.has(String(req.headers.host || ""))) {
    throw error("Request Host is forbidden.", "forbidden_host", 403);
  }

  const origin = req.headers.origin;
  if ((requireOrigin && origin === undefined) || (origin !== undefined && !isAllowedOrigin(origin))) {
    throw error("Request Origin is forbidden.", "forbidden_origin", 403);
  }

  if (authorize && !authorize(req.headers.authorization)) {
    throw error("Unauthorized.", "unauthorized", 401);
  }
}
