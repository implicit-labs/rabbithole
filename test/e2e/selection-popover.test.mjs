/** @protects selection popover capability contracts. */
import assert from "node:assert/strict";
import { bootWebApp } from "../support/web-app-harness.mjs";

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

  console.log("ok e2e: final-paragraph selection opens the popover");
} finally {
  await app.close();
}
