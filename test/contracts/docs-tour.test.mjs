/** @protects The offline, zero-network architecture tour. */
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the architecture tour opens offline without console errors or requests", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith("file:")) requests.push(request.url());
    });
    await page.goto(pathToFileURL(path.join(root, "docs/tour.html")).href, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".node, .card").length >= 5);
    assert.equal(await page.title(), "How Rabbithole works");
    assert.equal(requests.length, 0, `unexpected network requests: ${requests.join(", ")}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
