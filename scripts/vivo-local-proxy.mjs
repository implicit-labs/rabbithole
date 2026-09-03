/* Local dogfood server: serves the Vivo-configured Rabbithole build and proxies
   /api/* to staging on the SAME origin, so the browser needs no CORS and
   staging needs no config change. Run: node scripts/vivo-local-proxy.mjs */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8791;
const UPSTREAM = "https://dogfooding-memory-staging.onrender.com";
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
  ".png": "image/png", ".ico": "image/x-icon", ".map": "application/json",
  ".wasm": "application/wasm",
};

async function proxy(req, res) {
  const url = new URL(req.url, UPSTREAM);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
  const headers = {};
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
  try {
    const upstream = await fetch(url, /** @type {any} */ ({ method: req.method, headers, body, redirect: "manual" }));
    res.statusCode = upstream.status;
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.setHeader("cache-control", "no-store");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: "proxy_upstream_unreachable", detail: String(err) }));
  }
}

async function serveStaticFile(res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.setHeader("content-type", MIME[path.extname(filePath)] || "application/octet-stream");
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
  // Record-a-memo lives on the real staging web app.
  if (pathname === "/vivo") {
    res.statusCode = 302;
    res.setHeader("location", `${UPSTREAM}/vivo`);
    return res.end();
  }
  if (pathname.startsWith("/api/")) return proxy(req, res);
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (await serveStaticFile(res, path.join(DIST, rel))) return;
  // SPA fallback: every hole path renders index.html.
  await serveStaticFile(res, path.join(DIST, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Vivo dogfood server on http://localhost:${PORT}  (api -> ${UPSTREAM})`);
});
