/** @typedef {import("../../../src/core/contracts/generation.js").Provider} Provider */
/** @typedef {import("../../../src/core/contracts/generation.js").GenerationEvent} GenerationEvent */

/** @type {GenerationEvent[]} */
export const generationEventFixtures = [
  { type: "text", delta: "A streamed paragraph." },
  { type: "title", title: "Typed generation" },
];

/** @type {Provider} */
export const brainFixture = {
  async *answerBranch(_context, _signal) {
    yield generationEventFixtures[0];
    yield generationEventFixtures[1];
  },
  async *authorExplainer(_context, _signal) {
    yield { type: "text", delta: "An explanation." };
  },
  async *authorDocument(_source, _signal) {
    yield { type: "text", delta: "An authored document." };
    yield { type: "title", title: "Authored" };
  },
};
