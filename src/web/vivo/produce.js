/* Produce nodes: fan a document's Vivo atomic units out as answered, typed
   child nodes — no model call. Each node anchors to its verbatim evidence in
   the rendered root document when the quote can be located; otherwise it lands
   as a follow-up. Already-produced units (matched by unit id) are skipped, so
   the action is idempotent. */

import { randomId } from "../../core/utils.js";
import { buildNodeAnsweredEvent } from "../../core/hole-host.js";

const KIND_LABELS = {
  fact: "Fact",
  task: "Task",
  question: "Question",
  note: "Note",
  keepsake: "Keepsake",
};

/** @param {any} unit */
export function vivoUnitTitle(unit) {
  const text = String(unit.text || "").trim();
  return text.length > 64 ? `${text.slice(0, 63)}…` : text || KIND_LABELS[unit.kind] || "Unit";
}

/** @param {any} unit */
export function vivoUnitQuestion(unit) {
  const category = unit.task_category ? ` · ${String(unit.task_category).replaceAll("_", " ")}` : "";
  return `${KIND_LABELS[unit.kind] || "Unit"}${category} from this transcript`;
}

/** @param {any} unit */
export function vivoUnitMarkdown(unit) {
  const evidence = String(unit.verbatim || "").trim();
  const body = String(unit.text || "").trim();
  return evidence && evidence !== body ? `${body}\n\n> ${evidence}\n` : `${body}\n`;
}

/** @param {any} state */
export function pendingVivoUnits(state) {
  const root = state.nodes.get(state.root_id);
  const units = root?.extensions?.vivo?.units ?? [];
  if (!units.length) return { root, units: [], pending: [] };
  const produced = new Set();
  for (const node of state.nodes.values()) {
    const unitId = node?.extensions?.vivo?.unit_id;
    if (unitId) produced.add(unitId);
  }
  return { root, units, pending: units.filter((unit) => !produced.has(unit.unit_id)) };
}

/**
 * @param {{host: any, anchorForQuote?: (quote: string) => ({offset_start: number, offset_end: number} | null)}} input
 * @returns {Promise<{created: number, skipped: number}>}
 */
export async function produceVivoNodes({ host, anchorForQuote = () => null }) {
  const { root, units, pending } = pendingVivoUnits(host.state);
  if (!root || !units.length) throw new Error("This document has no Vivo units to produce.");
  const captureId = root.extensions?.vivo?.capture_id ?? null;

  let index = 0;
  for (const unit of pending) {
    const nodeId = randomId("vivo");
    const quote = String(unit.verbatim || "").trim();
    const anchor = quote ? anchorForQuote(quote) : null;
    const column = index % 3;
    const row = Math.floor(index / 3);
    const position = {
      x: (root.position?.x ?? 0) + (column - 1) * 460,
      y: (root.position?.y ?? 0) + 420 + row * 300,
    };
    host.dispatch({
      type: "branch_request",
      request_id: randomId("req"),
      node_id: nodeId,
      parent_id: root.id,
      selected_text: anchor ? quote : "",
      question: vivoUnitQuestion(unit),
      lens: null,
      anchor,
      branch_type: anchor ? "selection" : "followup",
      position,
      size: null,
    }, { now: new Date().toISOString() });
    host.dispatch({
      type: "node_answered",
      node_id: nodeId,
      title: vivoUnitTitle(unit),
      markdown: vivoUnitMarkdown(unit),
      read: true,
    });
    host.engine.patchExtension(nodeId, "vivo", {
      type: unit.kind,
      task_category: unit.task_category ?? null,
      unit_id: unit.unit_id,
      capture_id: captureId,
      status: unit.status ?? "inbox",
    });
    const node = host.state.nodes.get(nodeId);
    // Extensions ride the answered event so the card is typed at creation —
    // a patch alone would arrive before the browser knows the node exists.
    host.emit(buildNodeAnsweredEvent(node, { extensions: node.extensions }));
    index += 1;
  }
  await host.flushSave();
  return { created: pending.length, skipped: units.length - pending.length };
}
