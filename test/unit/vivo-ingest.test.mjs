/** @protects the Vivo transcript ingress: schema-valid holes carrying units in the vivo namespace. */
import assert from "node:assert/strict";
import { parsePersistedHole } from "../../src/core/schema.js";
import { toPersistedHole } from "../../src/core/schema.js";
import { vivoCaptureToStoredHole, vivoCaptureMarkdown } from "../../src/web/ingest/vivo.js";
import { vivoCaptureTitle } from "../../src/web/vivo/api.js";

const capture = {
  id: "cap_42",
  source: "voice",
  transcript: "[08:04] Ambient: I'm not a comms heavy person. I need to compare Redis and Postgres.",
  refined_transcript: null,
  summary: "Builder identity and a durability question",
  created_at: "2026-09-01T08:04:00.000Z",
  atomic_units: [
    { id: "u1", kind: "fact", task_category: null, text: "You're not a comms-heavy person.", verbatim: "I'm not a comms heavy person.", status: "inbox" },
    { id: "u2", kind: "task", task_category: "agentic", text: "Compare Redis and Postgres.", verbatim: "I need to compare Redis and Postgres.", status: "archived" },
  ],
};

// Titles prefer the summary and fall back to the day.
assert.equal(vivoCaptureTitle(capture), "Builder identity and a durability question");
assert.equal(vivoCaptureTitle({ summary: " ", created_at: "2026-09-01T08:00:00Z" }), "Voice session 2026-09-01");
assert.equal(vivoCaptureTitle({ summary: "x".repeat(120), created_at: "" }).length, 80);

// The document body is the raw transcript, so unit evidence stays findable.
assert.ok(vivoCaptureMarkdown(capture).includes(capture.transcript));

// The stored hole is schema-valid and the root carries the vivo namespace.
{
  const saved = [];
  const store = { saveHole: async (hole) => { saved.push(hole); } };
  const { hole } = await vivoCaptureToStoredHole({ capture, store });
  assert.equal(saved.length, 1);

  const parsed = parsePersistedHole(toPersistedHole(hole));
  const root = parsed.nodes.find((node) => node.id === parsed.root_id);
  assert.equal(parsed.title, "Builder identity and a durability question");
  assert.ok(root.markdown.includes("I'm not a comms heavy person."));
  assert.equal(root.extensions.vivo.capture_id, "cap_42");
  assert.equal(root.extensions.vivo.units.length, 2);
  assert.deepEqual(root.extensions.vivo.units[1], {
    unit_id: "u2",
    kind: "task",
    task_category: "agentic",
    text: "Compare Redis and Postgres.",
    verbatim: "I need to compare Redis and Postgres.",
    status: "archived",
  });
}

// A transcript-less capture is refused before anything is stored.
{
  const store = { saveHole: async () => { throw new Error("must not save"); } };
  await assert.rejects(
    () => vivoCaptureToStoredHole({ capture: { ...capture, transcript: "  " }, store }),
    /no transcript text/,
  );
}

console.log("ok vivo ingress: titles, raw-transcript body, vivo namespace round-trip");
