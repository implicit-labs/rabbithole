/** @protects produce-nodes: typed, anchored, idempotent fan-out of Vivo units into answered child nodes. */
import assert from "node:assert/strict";
import { DirectRabbitholeHost } from "../../src/web/transport/direct-host.js";
import { vivoCaptureToStoredHole } from "../../src/web/ingest/vivo.js";
import { pendingVivoUnits, produceVivoNodes, vivoUnitMarkdown } from "../../src/web/vivo/produce.js";
import { toPersistedHole, parsePersistedHole } from "../../src/core/schema.js";

const capture = {
  id: "cap_7",
  source: "voice",
  transcript: "I'm not a comms heavy person. I need to compare Redis and Postgres for durability.",
  summary: "Builder identity",
  created_at: "2026-09-01T08:00:00.000Z",
  atomic_units: [
    { id: "u1", kind: "fact", task_category: null, text: "You're not a comms-heavy person.", verbatim: "I'm not a comms heavy person.", status: "inbox" },
    { id: "u2", kind: "task", task_category: "agentic", text: "Compare Redis and Postgres.", verbatim: "I need to compare Redis and Postgres for durability.", status: "inbox" },
    { id: "u3", kind: "task", task_category: "idea", text: "Compare Redis and Postgres.", verbatim: "not actually in the transcript", status: "inbox" },
  ],
};

const saved = [];
const store = { saveHole: async (hole) => { saved.push(structuredClone(toPersistedHole(hole))); } };
const { hole } = await vivoCaptureToStoredHole({ capture, store });
const emitted = [];
const host = new DirectRabbitholeHost({ store, hole, provider: null });
const originalEmit = host.emit.bind(host);
host.emit = (event) => { emitted.push(event); return originalEmit(event); };

// The pending set is every unit before production.
assert.equal(pendingVivoUnits(host.state).pending.length, 3);

// Produce: anchors resolve through the callback; a failed lookup degrades to a follow-up.
const transcriptText = capture.transcript;
const result = await produceVivoNodes({
  host,
  anchorForQuote: (quote) => {
    const start = transcriptText.indexOf(quote);
    return start < 0 ? null : { offset_start: start, offset_end: start + quote.length };
  },
});
assert.deepEqual(result, { created: 3, skipped: 0 });

const nodes = [...host.state.nodes.values()].filter((node) => node.id !== host.state.root_id);
assert.equal(nodes.length, 3);
for (const node of nodes) {
  assert.equal(node.status, "answered");
  assert.equal(node.parent_id, host.state.root_id);
  assert.ok(node.extensions.vivo.unit_id);
  assert.equal(node.extensions.vivo.capture_id, "cap_7");
}
const fact = nodes.find((node) => node.extensions.vivo.unit_id === "u1");
assert.equal(fact.extensions.vivo.type, "fact");
assert.ok(fact.markdown.includes("You're not a comms-heavy person."));
assert.ok(fact.markdown.includes("> I'm not a comms heavy person."));
assert.equal(fact.origin.branch_type, "selection");
assert.deepEqual(fact.origin.anchor, { offset_start: 0, offset_end: 29 });

// A quote that cannot be located anchors nowhere but still lands as a follow-up.
const unanchored = nodes.find((node) => node.extensions.vivo.unit_id === "u3");
assert.equal(unanchored.origin.branch_type, "followup");

// The browser learned about each node over the wire.
assert.equal(emitted.filter((event) => event.type === "node_answered").length, 3);

// Idempotent: a second run creates nothing.
assert.deepEqual(await produceVivoNodes({ host }), { created: 0, skipped: 3 });
assert.equal([...host.state.nodes.values()].length, 4);

// Everything persists as a schema-valid hole.
const persisted = parsePersistedHole(saved.at(-1));
assert.equal(persisted.nodes.length, 4);

// Markdown formatting: evidence identical to the text is not repeated.
assert.equal(vivoUnitMarkdown({ text: "Same.", verbatim: "Same." }), "Same.\n");

console.log("ok vivo produce-nodes: typed anchored fan-out, wire events, idempotence, persistence");
