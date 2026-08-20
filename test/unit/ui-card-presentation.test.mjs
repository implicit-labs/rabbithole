import assert from "node:assert/strict";
import { nextOrder } from "../../src/ui/core.js";
import { raiseCard } from "../../src/ui/canvas-view.js";

const firstOrder = nextOrder();
const firstCard = { style: { transform: "translate(12px, 8px) scale(0.5)", opacity: "0.05" } };
const secondCard = { style: { transform: "rotate(1deg)" } };
raiseCard(firstCard);
raiseCard(secondCard);

assert.equal(Number(secondCard.style.zIndex) > Number(firstCard.style.zIndex), true,
  "each raise must receive a higher ephemeral stack value");
assert.deepEqual(firstCard.style, {
  transform: "translate(12px, 8px) scale(0.5)",
  opacity: "0.05",
  zIndex: firstCard.style.zIndex,
}, "raising a card must leave the docked-note FLIP styles untouched");
assert.equal(nextOrder(), firstOrder + 1, "card stacking must not consume the layout order counter");

console.log("ok UI card presentation: ephemeral stacking preserves layout and animation state");
