import { isAllowedBrowserOrigin } from "../shared/http-guard.js";

export const isAllowedOrigin = isAllowedBrowserOrigin;

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "7200");
}
