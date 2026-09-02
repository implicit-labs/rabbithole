/* Authenticated calls against the Vivo web APIs. The surface ticket is the
   only credential; responses are treated as data. */

/**
 * @typedef {{id: string, kind: string, task_category: string | null, text: string,
 *            verbatim: string | null, status: string}} VivoUnit
 * @typedef {{id: string, source: string, transcript: string, refined_transcript: string | null,
 *            summary: string | null, duration_ms: number | null, created_at: string,
 *            atomic_units: VivoUnit[]}} VivoCapture
 */

/** @param {Pick<VivoCapture, "summary" | "created_at">} capture */
export function vivoCaptureTitle(capture) {
  const summary = capture.summary?.trim();
  if (summary) return summary.length > 80 ? `${summary.slice(0, 79)}…` : summary;
  const day = String(capture.created_at || "").slice(0, 10);
  return day ? `Voice session ${day}` : "Voice session";
}

/** @param {string} baseUrl @param {string} ticket @returns {Promise<VivoCapture[]>} */
export async function listVivoCaptures(baseUrl, ticket, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const response = await fetchImpl(`${baseUrl}/api/debug/transcripts`, {
    headers: { authorization: `Bearer ${ticket}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new Error("Your Vivo session expired. Sign in again.");
  if (response.status === 403) throw new Error("This account is not on the Vivo staging allowlist.");
  if (!response.ok || !Array.isArray(body?.captures)) {
    throw new Error(body?.error || "Vivo transcripts are unavailable right now.");
  }
  return body.captures;
}

/**
 * Run the Vivo extraction pipeline over arbitrary text without persisting
 * anything server-side. Returns the projected units.
 * @param {string} baseUrl @param {string} ticket @param {string} text
 */
export async function extractVivoUnits(baseUrl, ticket, text, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const response = await fetchImpl(`${baseUrl}/api/extract`, {
    method: "POST",
    headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ text }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new Error("Your Vivo session expired. Sign in again.");
  if (response.status === 413) throw new Error("That document is too long for extraction.");
  if (!response.ok || !Array.isArray(body?.units)) {
    throw new Error(body?.error || "Vivo extraction is unavailable right now.");
  }
  return body;
}
