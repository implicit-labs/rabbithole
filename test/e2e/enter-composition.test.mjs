import assert from "node:assert/strict";
import { routeProvider, seedConfiguredOpenRouter } from "../support/provider-mock.mjs";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const { browser, baseUrl } = app;

try {
  await verifyEnterCompositionAndNewlines();
  console.log("enter composition verification passed");
} finally {
  await app.close();
}

async function verifyEnterCompositionAndNewlines() {
  const start = await openTestPage([["TITLE: Composer Enter\n", "Composer Enter completed."]]);
  try {
    await verifyStartComposer(start.page, () => start.providerCalls);
    assert.equal(start.providerCalls, 1, "plain Enter should submit the start composer exactly once");
  } finally {
    await start.context.close();
  }

  const documentPage = await openTestPage([
    ["TITLE: Selection Enter\n", "Selection Enter completed."],
    ["TITLE: Reader Enter\n", "Reader Enter completed."],
    ["TITLE: Reader Lens\n", "Reader lens completed."],
    ["TITLE: Card Enter\n", "Card Enter completed."],
    ["TITLE: Card Lens\n", "Card lens completed."],
  ]);
  try {
    await createDocument(documentPage.page, "# Enter handling\n\nEuler identity lets us test selection and follow-up inputs.");
    await documentPage.page.locator(".node .doc-content", { hasText: "Euler identity" }).first().waitFor();
    await verifySelectionCommitKeys(documentPage.page, () => documentPage.providerCalls);
    await verifyReaderComposer(documentPage.page, () => documentPage.providerCalls);
    await verifyCardComposer(documentPage.page, () => documentPage.providerCalls);
    assert.equal(documentPage.providerCalls, 5, "each in-document ask submit should call the provider exactly once");
  } finally {
    await documentPage.context.close();
  }
}

async function openTestPage(streams) {
  const context = await browser.newContext();
  await seedConfiguredOpenRouter(context);
  const page = await context.newPage();
  const state = { providerCalls: 0 };
  await routeProvider(page, {
    streams,
    onProviderCall: () => { state.providerCalls += 1; },
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__rabbitholeTest);
  return {
    context,
    page,
    get providerCalls() { return state.providerCalls; },
  };
}

async function verifyStartComposer(page, calls) {
  await page.click("#blank-start-new");
  await page.click("#composer-path-ask");
  await page.fill("#composer-input", "composing start");
  assert.equal((await dispatchComposingEnter(page, "#composer-input")).defaultPrevented, false);
  assert.equal(calls(), 0, "IME Enter must not submit the start composer");
  assert.equal(await page.locator("#composer-modal:not([hidden])").count(), 1);

  await page.fill("#composer-input", "line one");
  await page.focus("#composer-input");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  assert.equal(await page.inputValue("#composer-input"), "line one\nline two", "Shift+Enter should insert a newline in the start composer");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__rabbitholeTest?.currentHoleId?.());
  await page.waitForSelector("#composer-modal[hidden]", { state: "attached" });
  assert.equal(calls(), 1, "plain Enter should submit the start composer once");
}

async function verifySelectionCommitKeys(page, calls) {
  await selectText(page, "Euler identity");
  await page.waitForSelector("#ask.visible");
  await page.fill("#ask-text", "composing selection");
  assert.equal((await dispatchComposingEnter(page, "#ask-text")).defaultPrevented, false);
  assert.equal(calls(), 0, "IME Enter must not submit the selection ask composer");
  assert.equal(await page.locator("#ask.visible").count(), 1);

  await page.fill("#ask-text", "line one");
  await page.focus("#ask-text");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  assert.equal(await page.inputValue("#ask-text"), "line one\nline two", "Shift+Enter should insert a newline in the selection ask composer");
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector("#ask:not(.visible)", { state: "attached" });
  await page.locator(".node:not(.root)", { hasText: "Selection Enter completed." }).waitFor();
  assert.equal(calls(), 1, "Cmd/Ctrl+Enter should submit the selection ask once");
}

async function verifyReaderComposer(page, calls) {
  await page.evaluate(() => document.querySelector(".node.current [aria-label='Expand document']").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  await page.waitForFunction(() => !document.body.classList.contains("mode-canvas"));
  await assertComposerAtRest(page, "#composer-actions",
    "an empty reader composer should rest on the four lenses with the commit pair hidden");
  await page.fill("#composer-text", "composing reader");
  assert.equal((await dispatchComposingEnter(page, "#composer-text")).defaultPrevented, false);
  assert.equal(calls(), 1, "IME Enter must not submit the reader follow-up composer");

  await page.fill("#composer-text", "");
  const blankCount = await page.locator(".node").count();
  await page.press("#composer-text", "Enter");
  await page.press("#composer-text", "Control+Enter");
  assert.equal(await page.locator(".node").count(), blankCount, "blank reader Enter variants must be inert");
  assert.equal(calls(), 1, "blank reader Enter variants must not call the provider");

  await page.fill("#composer-text", "line one");
  assert.equal(await page.locator("#composer-inner").evaluate((inner) => inner.classList.contains("has-draft")), true,
    "a reader draft should reveal the shared commit pair");
  await page.focus("#composer-text");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  assert.equal(await page.inputValue("#composer-text"), "line one\nline two", "Shift+Enter should insert a newline in the reader follow-up composer");
  await page.keyboard.press("Enter");
  const readerNote = page.locator(".node-note", { hasText: "line one" }).last();
  await readerNote.waitFor({ state: "attached" });
  const readerNoteId = await readerNote.getAttribute("data-id");
  await page.waitForFunction(async (id) => {
    const hole = await window.__rabbitholeTest.readStoredHole();
    return hole.nodes.some((node) => node.id === id && node.origin?.kind === "note" && !node.origin.anchor && node.markdown === "line one\nline two");
  }, readerNoteId);
  assert.equal(await page.locator(`#margin-notes .side-item[data-child="${readerNoteId}"].followup`).count(), 1,
    "a reader Enter note should render as a follow-up tile");
  assert.equal(calls(), 1, "plain Enter should save a reader note without calling the provider");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#composer-actions .ask-commit"))
    .every((button) => getComputedStyle(button).display === "none"));

  await page.fill("#composer-text", "Reader command ask");
  await page.keyboard.press("Control+Enter");
  await page.locator("body", { hasText: "Reader Enter completed." }).waitFor();
  assert.equal(calls(), 2, "Cmd/Ctrl+Enter should submit the reader ask once");

  // Lenses live on follow-up composers too: an empty-box lens tap is a
  // whole-document ask with the canned lens question.
  await page.click('#composer-actions .lens[data-lens="explain"]');
  await page.locator("body", { hasText: "Reader lens completed." }).waitFor();
  assert.equal(calls(), 3, "an empty-box reader lens tap should submit one whole-document lens ask");
  await page.waitForFunction(async () => {
    const hole = await window.__rabbitholeTest.readStoredHole();
    return hole.nodes.some((node) => node.origin?.lens === "explain" && node.origin?.selected_text === "" && node.origin?.branch_type === "followup");
  });
}

async function verifyCardComposer(page, calls) {
  await page.evaluate(() => document.getElementById("reader-restore").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  await page.waitForFunction(() => document.body.classList.contains("mode-canvas"));
  await page.locator(".node.root .nc-handle").evaluate((button) => button.click());
  const selector = ".node.root .nc-inner textarea";
  await assertComposerAtRest(page, ".node.root .nc-inner .ask-actions",
    "an empty card composer should rest on the four lenses with the commit pair hidden");
  await page.fill(selector, "composing card");
  assert.equal((await dispatchComposingEnter(page, selector)).defaultPrevented, false);
  assert.equal(calls(), 3, "IME Enter must not submit the card follow-up composer");

  await page.fill(selector, "");
  const blankCount = await page.locator(".node").count();
  await page.press(selector, "Enter");
  await page.press(selector, "Control+Enter");
  assert.equal(await page.locator(".node").count(), blankCount, "blank card Enter variants must be inert");
  assert.equal(calls(), 3, "blank card Enter variants must not call the provider");

  await page.fill(selector, "line one");
  await page.focus(selector);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  assert.equal(await page.inputValue(selector), "line one\nline two", "Shift+Enter should insert a newline in the card follow-up composer");
  await page.keyboard.press("Enter");
  const cardNote = page.locator(".node-note", { hasText: "line one" }).last();
  await cardNote.waitFor();
  const cardNoteId = await cardNote.getAttribute("data-id");
  const storedCardNote = await page.waitForFunction(async (id) => {
    const hole = await window.__rabbitholeTest.readStoredHole();
    const note = hole.nodes.find((node) => node.id === id);
    const parent = note && hole.nodes.find((node) => node.id === note.parent_id);
    return note && parent ? { origin: note.origin, parentId: note.parent_id, x: note.position.x, y: note.position.y,
      parentX: parent.position.x, parentY: parent.position.y, markdown: note.markdown } : null;
  }, cardNoteId).then((handle) => handle.jsonValue());
  assert.deepEqual(storedCardNote.origin, { kind: "note" }, "card Enter should persist an anchor-less note origin");
  assert.equal(storedCardNote.x, storedCardNote.parentX, "card notes should use the follow-up lane's parent-aligned x position");
  assert(storedCardNote.y > storedCardNote.parentY, "card notes should be placed below their parent in the follow-up lane");
  assert.equal(storedCardNote.markdown, "line one\nline two");
  assert.equal(calls(), 3, "plain Enter should save a card note without calling the provider");

  await page.locator(".node.root .nc-handle").evaluate((button) => button.click());
  await page.fill(selector, "Card command ask");
  await page.keyboard.press("Control+Enter");
  await page.locator(".node:not(.root)", { hasText: "Card Enter completed." }).waitFor();
  assert.equal(calls(), 4, "Cmd/Ctrl+Enter should submit the card ask once");

  await page.locator(".node.root .nc-handle").evaluate((button) => button.click());
  await page.locator('.node.root .nc-inner .lens[data-lens="eli5"]').evaluate((button) => button.click());
  await page.locator(".node:not(.root)", { hasText: "Card lens completed." }).waitFor();
  assert.equal(calls(), 5, "an empty-box card lens tap should submit one whole-document lens ask");
}

async function assertComposerAtRest(page, selector, message) {
  assert.deepEqual(await page.locator(selector).evaluate((row) => ({
    lensesVisible: Array.from(row.querySelectorAll(".lens")).every((button) => getComputedStyle(button).display !== "none"),
    commitsHidden: Array.from(row.querySelectorAll(".ask-commit")).every((button) => getComputedStyle(button).display === "none"),
  })), { lensesVisible: true, commitsHidden: true }, message);
}

async function dispatchComposingEnter(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    Object.defineProperty(event, "keyCode", { get: () => 229 });
    const allowed = element.dispatchEvent(event);
    return { allowed, defaultPrevented: event.defaultPrevented };
  });
}

async function createDocument(page, markdown) {
  const previous = await page.evaluate(() => window.__rabbitholeTest?.currentHoleId?.() || "");
  await page.evaluate((value) => window.__rabbitholeTest.createDocument(value), markdown);
  await page.waitForFunction((oldId) => {
    const id = window.__rabbitholeTest?.currentHoleId?.();
    return id && id !== oldId && document.querySelector(".doc-content");
  }, previous);
  return page.evaluate(() => window.__rabbitholeTest.currentHoleId());
}

async function selectText(page, text) {
  await page.evaluate((targetText) => {
    const root = document.querySelector(".node .doc-content[data-node-id]");
    if (!root) throw new Error("No document content to select");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.nodeValue.indexOf(targetText);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + targetText.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 160 }));
      return;
    }
    throw new Error(`Text not found: ${targetText}`);
  }, text);
}
