import assert from "node:assert/strict";
import { createSaveChain } from "../../src/core/hole-host.js";

let snapshot = 0;
const writes = [];
const chain = createSaveChain({
  debounceMs: 1000,
  save: () => {
    const captured = snapshot;
    return async () => { writes.push(captured); };
  },
});

await chain.flush();
assert.deepEqual(writes, [], "a clean flush must not rewrite an unchanged hole");

snapshot = 1;
chain.markDirty();
const first = chain.flush();
assert.equal(chain.flush(), first, "overlapping clean flushes should share the queued write");
await first;
assert.deepEqual(writes, [1]);

await chain.flush();
assert.deepEqual(writes, [1], "a completed version should stay clean");

snapshot = 2;
chain.schedule();
await chain.flush();
assert.deepEqual(writes, [1, 2], "a scheduled version should flush immediately when requested");

let attempts = 0;
const retry = createSaveChain({
  debounceMs: 1000,
  save: () => async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient");
  },
});
retry.markDirty();
await assert.rejects(retry.flush(), /transient/);
await retry.flush();
assert.equal(attempts, 2, "the latest failed version should remain retryable");

console.log("save chain verification passed");
