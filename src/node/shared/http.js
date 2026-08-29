const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB — answers can be large
const CLOSE_TIMEOUT_MS = 5000;

class HttpStatusError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function buildJsonError(message, status = 400) {
  return new HttpStatusError(message, status);
}

export function parseRequestBody(req, {
  maxBytes = MAX_BODY_BYTES,
  tooLargeError = buildJsonError("Request body too large", 413),
} = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;

    const rejectTooLarge = () => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.removeListener("data", onData);
      req.resume();
      reject(tooLargeError);
    };

    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        rejectTooLarge();
        return;
      }
      chunks.push(chunk);
    };

    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      rejectTooLarge();
      return;
    }

    req.on("data", onData);
    req.on("end", () => {
      if (settled) return;
      settled = true;
      // Decode the whole buffer once — decoding per chunk would corrupt a
      // multi-byte UTF-8 character split across a chunk boundary.
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(buildJsonError(`Invalid JSON in request: ${err.message}`, 400));
      }
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

/** @param {import("node:http").Server} server @param {{timeoutMs?: number, onClosed?: () => void}} [options] */
export function closeServerGracefully(server, { timeoutMs = CLOSE_TIMEOUT_MS, onClosed } = {}) {
  const timer = setTimeout(() => {
    server.closeAllConnections?.();
  }, timeoutMs);

  server.close(() => {
    clearTimeout(timer);
    onClosed?.();
  });
}
