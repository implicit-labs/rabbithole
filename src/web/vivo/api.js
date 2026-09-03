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

/**
 * Toggle a produced unit's reviewed state on the server. Returns the updated
 * unit row (archive shape), whose `status` reflects inbox vs. archived.
 * @param {string} baseUrl @param {string} ticket @param {string} captureId @param {string} unitId @param {boolean} reviewed
 */
export async function reviewVivoUnit(baseUrl, ticket, captureId, unitId, reviewed, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const response = await fetchImpl(`${baseUrl}/api/debug/transcripts`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ capture_id: captureId, unit_id: unitId, reviewed }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new Error("Your Vivo session expired. Sign in again.");
  if (!response.ok || !body?.unit) throw new Error(body?.error || "The review status could not be updated.");
  return body.unit;
}

/**
 * Mint atomic units from a highlighted transcript passage. The server verifies
 * the passage against the stored transcript and persists the resulting units
 * on the capture; the response uses the archive's atomic-unit shape.
 * @param {string} baseUrl @param {string} ticket @param {string} captureId @param {string} passage
 * @returns {Promise<{units: VivoUnit[]}>}
 */
export async function createVivoUnitsFromPassage(baseUrl, ticket, captureId, passage, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const response = await fetchImpl(`${baseUrl}/api/debug/transcripts/units`, {
    method: "POST",
    headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ capture_id: captureId, passage }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new Error("Your Vivo session expired. Sign in again.");
  if (response.status === 413) throw new Error("That selection is too long — highlight a tighter passage.");
  if (response.status === 422) throw new Error("That selection doesn't match the raw transcript, so it can't ground a unit.");
  if (!response.ok || !Array.isArray(body?.units)) {
    throw new Error(body?.error || "Creating the unit is unavailable right now.");
  }
  return { units: body.units };
}
