/* Vivo transcript ingress: turn one captured session into a stored hole whose
   root document is the transcript. The capture id and the session's atomic
   units ride along in the root node's `extensions.vivo` namespace so
   produce-nodes can fan them out later without another network call. */

import { createHoleFromMarkdown } from "../transport/direct-host.js";
import { vivoCaptureTitle } from "../vivo/api.js";

const VIVO_NAMESPACE = "vivo";

/**
 * The reading transcript becomes the document body. The raw transcript is what
 * evidence quotes are grounded in, so it is the authoritative body; a refined
 * transcript, when distinct, would break anchor lookup and is ignored here.
 * @param {any} capture
 */
export function vivoCaptureMarkdown(capture) {
  const title = vivoCaptureTitle(capture);
  const transcript = String(capture.transcript || "").trim();
  return `# ${title}\n\n${transcript}\n`;
}

/**
 * @param {{capture: any, store: any}} input
 * @returns {Promise<{hole: any}>}
 */
export async function vivoCaptureToStoredHole({ capture, store }) {
  const transcript = String(capture.transcript || "").trim();
  if (!transcript) throw new Error("This session has no transcript text.");
  const hole = createHoleFromMarkdown({
    title: vivoCaptureTitle(capture),
    markdown: vivoCaptureMarkdown(capture),
    baseUrl: "",
  });
  const root = hole.nodes.find((node) => node.id === hole.root_id) ?? hole.nodes[0];
  root.extensions = {
    ...root.extensions,
    [VIVO_NAMESPACE]: {
      capture_id: capture.id,
      source: capture.source ?? "voice",
      created_at: capture.created_at ?? null,
      units: (capture.atomic_units ?? []).map((unit) => ({
        unit_id: unit.id,
        kind: unit.kind,
        task_category: unit.task_category ?? null,
        text: unit.text,
        verbatim: unit.verbatim ?? null,
        status: unit.status ?? "inbox",
      })),
    },
  };
  await store.saveHole(hole);
  return { hole };
}
