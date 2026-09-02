/** @protects selection-to-unit: raw-passage recovery from DOM selections and unit folding into the vivo namespace. */
import assert from "node:assert/strict";
import { rawPassageForSelection } from "../../src/web/vivo/passage.js";
import { appendVivoUnits, pendingVivoUnits, produceVivoNodes } from "../../src/web/vivo/produce.js";
import { vivoCaptureToStoredHole } from "../../src/web/ingest/vivo.js";
import { DirectRabbitholeHost } from "../../src/web/transport/direct-host.js";

// Exact substrings pass through untouched.
assert.equal(rawPassageForSelection("one two three", "two three"), "two three");

// Rendered selections collapse whitespace; the raw slice comes back verbatim.
const raw = "[08:04] Ambient: line one\nline two continues.\n\nSecond paragraph here.";
assert.equal(
  rawPassageForSelection(raw, "line one line two continues."),
  "line one\nline two continues.",
);
assert.equal(
  rawPassageForSelection(raw, "continues. Second paragraph"),
  "continues.\n\nSecond paragraph",
);

// Unmatchable or empty selections refuse rather than guess.
assert.equal(rawPassageForSelection(raw, "words that are not there"), null);
assert.equal(rawPassageForSelection(raw, "   "), null);
assert.equal(rawPassageForSelection("", "x"), null);

// appendVivoUnits folds minted units into the root namespace, skipping known ids.
{
  const capture = {
    id: "cap_9",
    source: "voice",
    transcript: "I want to write about funnels. Also remember I hate mornings.",
    summary: "Funnel thoughts",
    created_at: "2026-09-02T08:00:00.000Z",
    atomic_units: [
      { id: "u1", kind: "task", task_category: "idea", text: "Write about funnels.", verbatim: "I want to write about funnels.", status: "inbox" },
    ],
  };
  const store = { saveHole: async () => {} };
  const { hole } = await vivoCaptureToStoredHole({ capture, store });
  const host = new DirectRabbitholeHost({ store, hole, provider: null });

  const added = appendVivoUnits({
    host,
    units: [
      { id: "u2", kind: "fact", task_category: null, text: "You hate mornings.", verbatim: "I hate mornings.", status: "inbox" },
      { id: "u1", kind: "task", task_category: "idea", text: "duplicate", verbatim: null, status: "inbox" },
    ],
  });
  assert.equal(added, 1);
  const root = host.state.nodes.get(host.state.root_id);
  assert.equal(root.extensions.vivo.units.length, 2);
  assert.deepEqual(root.extensions.vivo.units[1], {
    unit_id: "u2", kind: "fact", task_category: null,
    text: "You hate mornings.", verbatim: "I hate mornings.", status: "inbox",
  });

  // The appended unit is now pending and produces an anchored node.
  assert.equal(pendingVivoUnits(host.state).pending.length, 2);
  const result = await produceVivoNodes({
    host,
    anchorForQuote: (quote) => {
      const start = capture.transcript.indexOf(quote);
      return start < 0 ? null : { offset_start: start, offset_end: start + quote.length };
    },
  });
  assert.equal(result.created, 2);
  const minted = [...host.state.nodes.values()].find((node) => node.extensions?.vivo?.unit_id === "u2");
  assert.equal(minted.origin.branch_type, "selection");
}

console.log("ok vivo passage: raw recovery, unit folding, anchored production");
