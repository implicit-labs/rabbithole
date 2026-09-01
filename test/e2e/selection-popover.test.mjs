/** @protects selection popover capability contracts. */
import assert from "node:assert/strict";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { assertSelectionPopoverUsable } from "../support/visible-selection.mjs";

const app = await bootWebApp();
const { browser, baseUrl } = app;

try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.__rabbitholeTest.createDocument([
    "# Paragraph selection",
    "",
    "The middle paragraph should open the selection popover.",
    "",
    "The final paragraph should open the selection popover too.",
  ].join("\n")));
  await page.waitForSelector(".card.root .doc-content p:nth-of-type(2)");

  const paragraphs = page.locator(".card.root .doc-content p");
  await paragraphs.nth(0).click({ clickCount: 3, position: { x: 36, y: 10 } });
  await page.waitForSelector("#ask.visible");

  await page.keyboard.press("Escape");
  await page.waitForSelector("#ask:not(.visible)", { state: "attached" });

  await paragraphs.nth(1).click({ clickCount: 3, position: { x: 36, y: 10 } });
  await page.waitForSelector("#ask.visible", { timeout: 1_000 });

  await page.keyboard.press("Escape");
  await page.waitForSelector("#ask:not(.visible)", { state: "attached" });
  await page.evaluate(() => {
    const paragraphText = document.querySelector(".card.root .doc-content p:last-child").firstChild;
    const controlText = document.querySelector(".card.root .nc-handle").lastChild;
    const range = document.createRange();
    range.setStart(paragraphText, 0);
    range.setEnd(controlText, controlText.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#ask.visible").count(), 0,
    "a real selection extending into card controls must remain rejected");

  // The popover must stay with its selection while the canvas view moves
  // underneath it — a trackpad wheel-pan repositions the world without any
  // pointer leaving the surface open and stranded in screen space.
  await paragraphs.nth(0).click({ clickCount: 3, position: { x: 36, y: 10 } });
  await page.waitForSelector("#ask.visible");
  const drift = await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await settle();
    const ask = document.getElementById("ask");
    const before = ask.getBoundingClientRect();
    document.getElementById("viewport").dispatchEvent(
      new WheelEvent("wheel", { deltaX: 64, deltaY: 48, bubbles: true, cancelable: true }),
    );
    await settle();
    const after = ask.getBoundingClientRect();
    return { dx: after.left - before.left, dy: after.top - before.top };
  });
  assert.ok(
    Math.abs(drift.dx + 64) <= 2 && Math.abs(drift.dy + 48) <= 2,
    `the selection popover must track a canvas pan (moved ${drift.dx},${drift.dy}; expected -64,-48)`,
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector("#ask:not(.visible)", { state: "attached" });

  // The popover annotates visible text: pan the card fully off-screen and the
  // surface hides with it (still open, draft intact); pan back and it returns.
  await paragraphs.nth(0).click({ clickCount: 3, position: { x: 36, y: 10 } });
  await page.waitForSelector("#ask.visible");
  const wheelPan = (dx, dy) =>
    page.evaluate(async ([deltaX, deltaY]) => {
      document
        .getElementById("viewport")
        .dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, [dx, dy]);
  await wheelPan(2600, 0);
  await page.waitForSelector("#ask.visible[data-anchor-hidden]");
  await wheelPan(-2600, 0);
  await page.waitForSelector("#ask.visible:not([data-anchor-hidden])");

  // The same rule inside a card: scroll the selection out of the card body and
  // the popover hides; scroll back and it returns.
  await page.evaluate(() => {
    const dc = document.querySelector(".card.root .doc-content");
    for (let i = 0; i < 40; i++) {
      const p = document.createElement("p");
      p.textContent = `Filler paragraph ${i} so the card body scrolls.`;
      dc.appendChild(p);
    }
  });
  const scrollCardBody = (top) =>
    page.evaluate(async (scrollTop) => {
      document.querySelector(".card.root .card-body").scrollTop = scrollTop;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, top);
  await scrollCardBody(4000);
  await page.waitForSelector("#ask.visible[data-anchor-hidden]");
  await scrollCardBody(0);
  await page.waitForSelector("#ask.visible:not([data-anchor-hidden])");
  await assertSelectionPopoverUsable(page);
  await page.fill("#ask-text", "The returned popover still commits");
  await assertSelectionPopoverUsable(page);
  await page.click('#ask .ask-commit[data-commit="note"]', { timeout: 4_000 });
  await page.waitForSelector("#ask:not(.visible)", { state: "attached" });
  await page.waitForSelector(".card.root .note-dot");
  await page.waitForFunction(async () => (await window.__rabbitholeTest.readStoredHole()).nodes.some(
    (node) => node.origin?.kind === "note" && node.markdown === "The returned popover still commits",
  ));

  console.log("ok e2e: selection popover returns from hidden anchors and remains usable");
} finally {
  await app.close();
}
