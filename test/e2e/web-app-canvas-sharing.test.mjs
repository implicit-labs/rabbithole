import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { extractSnapshotPayload } from "../../src/core/portable-import.js";
import { serializeForInlineScript } from "../../src/core/utils.js";
import { assertCodeCopy } from "../support/code-copy.mjs";
import { MOCK_MODEL, corsHeaders, routeProvider, seedConfiguredOpenRouter } from "../support/provider-mock.mjs";
import { ROOT, bootWebApp } from "../support/web-app-harness.mjs";

const MOCK_KEY = `sk-or-v1-${"x".repeat(64)}`;
const BAD_KEY = `sk-or-v1-${"y".repeat(64)}`;
const PROVIDER_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_URL = "https://openrouter.ai/api/v1/key";
const MODEL_URL = "https://openrouter.ai/api/v1/models";
const LOCAL_MODEL_URL = "http://localhost:11434/v1/models";

const hostilePayloadValue = { text: "</script><>&\u2028\u2029" };
const hostilePayloadJson = serializeForInlineScript(hostilePayloadValue);
assert(!/[<>&\u2028\u2029]/u.test(hostilePayloadJson), "portable payload escaping must neutralize HTML delimiters and JavaScript line separators");
assert.deepEqual(JSON.parse(hostilePayloadJson), hostilePayloadValue, "escaped inert payload text must JSON.parse byte-exactly");

const app = await bootWebApp();
const { browser, baseUrl } = app;
const mobileWebKit = await webkit.launch();
try {
  await verifyMobileCanvasNavigation(browser, "chromium");
  await verifyMobileCanvasNavigation(mobileWebKit, "webkit");
  await verifyDesktopReaderLayout(browser);
  await verifyMobileSelectionSurface(browser, "chromium");
  await verifyMobileSelectionSurface(mobileWebKit, "webkit");
  await verifyAnchoredNotes();
  await verifyStandaloneNotesAndEditing();
  await verifyStandaloneImagePaste();
  await verifyLogicalMarkGrouping();
  await verifyCanvasBranching();
  console.log("web app verification passed");
} finally {
  await mobileWebKit.close();
  await app.close();
}

async function verifyMobileCanvasNavigation(browserEngine, engineName) {
  const context = await browserEngine.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await routeProvider(page);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const paragraphs = Array.from({ length: 42 }, (_, index) =>
      `Paragraph ${index + 1}. Mobile canvas navigation must keep card reading independent from camera movement.`).join("\n\n");
    await createDocument(page, `# Mobile canvas navigation\n\n${paragraphs}`);
    await page.waitForFunction(() => {
      const body = document.querySelector(".node.root .node-body");
      return document.body.classList.contains("mode-canvas")
        && body && body.scrollHeight > body.clientHeight + 100
        && getComputedStyle(document.getElementById("world")).transform !== "none";
    });

    const toolbar = await page.locator("#taskbar").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const controls = ["t-zout", "zoom-label", "t-zin"].map((id) => {
        const item = document.getElementById(id).getBoundingClientRect();
        return { id, width: item.width, height: item.height, right: item.right };
      });
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: innerWidth,
        scrollable: element.scrollWidth > element.clientWidth, controls };
    });
    assert(toolbar.left >= 0 && toolbar.right <= toolbar.viewportWidth,
      `${engineName}: mobile taskbar must stay inside the viewport (${JSON.stringify(toolbar)})`);
    for (const control of toolbar.controls) {
      assert(control.width >= 44 && control.height >= 44,
        `${engineName}: ${control.id} must be a reliable mobile touch target (${JSON.stringify(control)})`);
    }
    // Start from a known scale: initial framing may still be settling on a
    // resource-constrained mobile engine, and zoom-in is intentionally a no-op
    // at the 250% ceiling.
    await page.click("#zoom-label");
    await page.waitForFunction(() => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("world")).transform);
      return Math.abs(matrix.a - 1) < 0.001;
    });
    const scaleBeforeButton = await readCanvasView(page);
    await page.click("#t-zin");
    await page.waitForFunction((previousScale) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("world")).transform);
      return matrix.a > previousScale + 0.01;
    }, scaleBeforeButton.scale);
    const scaleAfterButton = await readCanvasView(page);
    assert(scaleAfterButton.scale > scaleBeforeButton.scale,
      `${engineName}: mobile zoom-in control must change the canvas scale`);
    await page.click("#zoom-label");
    await page.waitForFunction(() => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("world")).transform);
      return Math.abs(matrix.a - 1) < 0.001;
    });
    const resetView = await readCanvasView(page);
    assert(Math.abs(resetView.scale - 1) < 0.001,
      `${engineName}: tapping the mobile zoom label must reset to 100%`);

    if (engineName === "chromium") await verifyRealChromiumTouches(context, page);

    const contentRoute = await page.locator(".node.root .node-body").evaluate((body) => {
      const world = document.getElementById("world");
      function view() {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
        return { x: matrix.e, y: matrix.f, scale: matrix.a };
      }
      function fire(type, id, x, y, buttons) {
        const event = new PointerEvent(type, { bubbles: true, cancelable: true,
          pointerId: id, pointerType: "touch", isPrimary: true, button: 0,
          buttons, clientX: x, clientY: y });
        body.dispatchEvent(event);
        return event.defaultPrevented;
      }
      const before = view();
      const downPrevented = fire("pointerdown", 11, 180, 420, 1);
      const movePrevented = fire("pointermove", 11, 180, 350, 1);
      fire("pointerup", 11, 180, 350, 0);
      return { before, after: view(), downPrevented, movePrevented,
        touchAction: getComputedStyle(body).touchAction,
        scrollable: body.scrollHeight > body.clientHeight };
    });
    assert.equal(contentRoute.downPrevented, false,
      `${engineName}: a one-finger card gesture must remain available to the native scroller`);
    assert.equal(contentRoute.movePrevented, false,
      `${engineName}: card scrolling must not be stolen by the canvas camera`);
    assert.equal(contentRoute.scrollable, true, `${engineName}: the mobile card fixture must actually scroll`);
    assert.match(contentRoute.touchAction, /pan-x|pan-y/,
      `${engineName}: card bodies must advertise native one-finger panning`);
    assert.deepEqual(contentRoute.after, contentRoute.before,
      `${engineName}: a one-finger gesture inside a card must not move the canvas`);

    const backgroundPan = await page.locator("#viewport").evaluate((surface) => {
      const world = document.getElementById("world");
      function view() {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
        return { x: matrix.e, y: matrix.f, scale: matrix.a };
      }
      function fire(type, x, y, buttons) {
        surface.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
          pointerId: 21, pointerType: "touch", isPrimary: true, button: 0,
          buttons, clientX: x, clientY: y }));
      }
      const before = view();
      fire("pointerdown", 340, 730, 1);
      fire("pointermove", 292, 668, 1);
      fire("pointerup", 292, 668, 0);
      return { before, after: view(), panning: surface.classList.contains("panning") };
    });
    assert(Math.abs((backgroundPan.after.x - backgroundPan.before.x) + 48) < 0.01,
      `${engineName}: one finger on empty canvas must pan horizontally 1:1 (${JSON.stringify(backgroundPan)})`);
    assert(Math.abs((backgroundPan.after.y - backgroundPan.before.y) + 62) < 0.01,
      `${engineName}: one finger on empty canvas must pan vertically 1:1 (${JSON.stringify(backgroundPan)})`);
    assert.equal(backgroundPan.after.scale, backgroundPan.before.scale,
      `${engineName}: one-finger canvas panning must not alter zoom`);
    assert.equal(backgroundPan.panning, false, `${engineName}: the pan state must clean up after pointerup`);

    const pinch = await page.locator(".node.root .node-body").evaluate((body) => {
      const surface = document.getElementById("viewport");
      const world = document.getElementById("world");
      function view() {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
        return { x: matrix.e, y: matrix.f, scale: matrix.a };
      }
      function fire(type, id, x, y, buttons, primary) {
        body.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
          pointerId: id, pointerType: "touch", isPrimary: primary, button: 0,
          buttons, clientX: x, clientY: y }));
      }
      const before = view();
      const startMid = { x: 160, y: 340 };
      const anchor = { x: (startMid.x - before.x) / before.scale,
        y: (startMid.y - before.y) / before.scale };
      fire("pointerdown", 31, 80, 340, 1, true);
      fire("pointerdown", 32, 240, 340, 1, false);
      fire("pointermove", 31, 50, 320, 1, true);
      fire("pointermove", 32, 310, 380, 1, false);
      const after = view();
      const finalMid = { x: 180, y: 350 };
      const anchoredAt = { x: anchor.x * after.scale + after.x,
        y: anchor.y * after.scale + after.y };
      fire("pointerup", 31, 50, 320, 0, true);
      fire("pointerup", 32, 310, 380, 0, false);
      return { before, after, finalMid, anchoredAt,
        pinching: surface.classList.contains("pinching"),
        panning: surface.classList.contains("panning") };
    });
    assert(pinch.after.scale > pinch.before.scale * 1.5,
      `${engineName}: spreading two fingers must zoom the canvas continuously (${JSON.stringify(pinch)})`);
    assert(Math.abs(pinch.anchoredAt.x - pinch.finalMid.x) < 0.05
      && Math.abs(pinch.anchoredAt.y - pinch.finalMid.y) < 0.05,
      `${engineName}: pinch zoom must keep the original midpoint content under the moving fingers (${JSON.stringify(pinch)})`);
    assert.equal(pinch.pinching, false, `${engineName}: pinch state must clean up after both fingers lift`);
    assert.equal(pinch.panning, false, `${engineName}: pinch-to-pan continuation must clean up after the last finger lifts`);

    // Touch gestures arm the canvas ghost-click suppressor for up to 450ms —
    // let it lapse before driving the expand control.
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector(".node.current [aria-label='Expand document']").click());
    await page.waitForFunction(() => !document.body.classList.contains("mode-canvas"));
    await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
    assert.deepEqual(await composerRowState(page, "#composer-actions"), { lensesVisible: true, commitsHidden: true },
      `${engineName}: an empty mobile reader composer must rest on the four lenses with the commit pair hidden`);
    await page.fill("#composer-text", "Mobile follow-up draft");
    const mobileReader = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom,
          width: value.width, height: value.height };
      };
      const main = document.getElementById("reader-main");
      const input = document.getElementById("composer-text");
      const commits = Array.from(document.querySelectorAll("#composer-actions .ask-commit")).map((button) => {
        const value = button.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom,
          width: value.width, height: value.height };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        reader: rect("#reader"),
        top: rect("#taskbar"),
        main: { ...rect("#reader-main"), clientWidth: main.clientWidth, scrollWidth: main.scrollWidth,
          clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, touchAction: getComputedStyle(main).touchAction },
        column: rect(".reader-col"),
        composer: rect("#composer"),
        inputFont: parseFloat(getComputedStyle(input).fontSize),
        commits,
        notesDisplay: getComputedStyle(document.getElementById("margin-notes")).display,
      };
    });
    assert.equal(mobileReader.reader.width, mobileReader.viewport.width,
      `${engineName}: the mobile reader must own the full viewport width (${JSON.stringify(mobileReader)})`);
    assert(mobileReader.main.width >= mobileReader.viewport.width - 1,
      `${engineName}: the hidden desktop branch rail must not squeeze the document (${JSON.stringify(mobileReader)})`);
    assert(mobileReader.column.width >= mobileReader.viewport.width - 48,
      `${engineName}: the phone reading column must remain comfortably readable (${JSON.stringify(mobileReader)})`);
    assert(mobileReader.main.scrollWidth <= mobileReader.main.clientWidth,
      `${engineName}: the mobile reader must not have page-level horizontal overflow (${JSON.stringify(mobileReader)})`);
    assert(mobileReader.main.scrollHeight > mobileReader.main.clientHeight + 200,
      `${engineName}: the mobile reader fixture must expose a real vertical reading surface`);
    assert.match(mobileReader.main.touchAction, /pan-y/,
      `${engineName}: one-finger swipes must be routed to native vertical reading (${JSON.stringify(mobileReader)})`);
    assert(mobileReader.composer.bottom <= mobileReader.viewport.height + 0.5,
      `${engineName}: the follow-up composer must remain above the phone viewport edge (${JSON.stringify(mobileReader)})`);
    assert(mobileReader.inputFont >= 16,
      `${engineName}: the mobile follow-up field must not trigger iOS focus zoom`);
    assert(mobileReader.commits.every((target) => target.width >= 44 && target.height >= 44),
      `${engineName}: both mobile follow-up commit targets must be at least 44px (${JSON.stringify(mobileReader)})`);
    assert.equal(mobileReader.notesDisplay, "none",
      `${engineName}: margin notes must stay out of the phone reading surface — inline marks carry narrow screens`);

    await page.fill("#composer-text", "");
    if (engineName === "chromium") await verifyRealChromiumReaderScroll(context, page);

    await page.close();
  } finally {
    await context.close();
  }
}

async function verifyRealChromiumReaderScroll(context, page) {
  const client = await context.newCDPSession(page);
  const main = await page.locator("#reader-main").evaluate((element) => {
    element.scrollTop = 0;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, startY: rect.bottom - 70, endY: rect.top + 70 };
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart",
    touchPoints: [{ id: 61, x: main.x, y: main.startY, radiusX: 4, radiusY: 4, force: 1 }] });
  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 61,
      x: main.x, y: main.startY + (main.endY - main.startY) * step / 6,
      radiusX: 4, radiusY: 4, force: 1 }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  const scrollTop = await page.locator("#reader-main").evaluate((element) => element.scrollTop);
  assert(scrollTop > 80, `chromium: a physical one-finger reader swipe must scroll the document (got ${scrollTop})`);
  await client.detach();
}

async function verifyDesktopReaderLayout(browserEngine) {
  const context = await browserEngine.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await routeProvider(page);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, "# Desktop reader invariant\n\nThe established desktop layout must remain unchanged.");
    await page.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
    await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
    const desktop = await page.evaluate(() => {
      const notes = document.getElementById("margin-notes");
      const main = document.getElementById("reader-main");
      const mainStyle = getComputedStyle(main);
      const column = document.querySelector(".reader-col").getBoundingClientRect();
      const notesRect = notes.getBoundingClientRect();
      const rail = document.getElementById("reader-rail").getBoundingClientRect();
      const workspaceStyle = getComputedStyle(document.getElementById("reader-workspace"));
      const bar = document.getElementById("taskbar").getBoundingClientRect();
      const session = document.getElementById("tb-session").getBoundingClientRect();
      const readerTop = document.getElementById("reader").getBoundingClientRect().top
        + parseFloat(getComputedStyle(document.getElementById("reader")).paddingTop);
      return { notesDisplay: getComputedStyle(notes).display, notesLeft: notesRect.left, notesRight: notesRect.right, columnRight: column.right,
        mainWidth: main.getBoundingClientRect().width, mainRight: main.getBoundingClientRect().right,
        railLeft: rail.left, railRight: rail.right, railWidth: rail.width,
        viewportWidth: innerWidth, barHeight: bar.height, barBottom: bar.bottom, contentTop: readerTop,
        workspaceBorderTopStyle: workspaceStyle.borderTopStyle,
        workspaceBorderTopWidth: parseFloat(workspaceStyle.borderTopWidth),
        sessionRight: session.right,
        doneDisplay: getComputedStyle(document.getElementById("tb-done-pill")).display,
        mainPaddingLeft: parseFloat(mainStyle.paddingLeft) };
    });
    assert.equal(desktop.notesDisplay, "flex", `desktop: the branch rail must be live beside the document (${JSON.stringify(desktop)})`);
    assert(Math.abs(desktop.mainRight - desktop.railLeft) <= 1, `desktop: the document and branch rail must meet without a dead strip (${JSON.stringify(desktop)})`);
    assert(desktop.notesLeft >= desktop.railLeft && desktop.notesRight <= desktop.railRight,
      `desktop: branch cards must stay inside the right rail (${JSON.stringify(desktop)})`);
    assert(desktop.columnRight < desktop.railLeft, `desktop: prose must stay inside the remaining document pane (${JSON.stringify(desktop)})`);
    assert(Math.abs(desktop.mainWidth + desktop.railWidth - desktop.viewportWidth) <= 1,
      `desktop: document plus branch rail must consume exactly the viewport (${JSON.stringify(desktop)})`);
    assert(Math.abs(desktop.viewportWidth - desktop.railRight) <= 1, `desktop: the branch rail must hug the physical right edge (${JSON.stringify(desktop)})`);
    assert(desktop.barHeight < 52, `desktop: the shared taskbar must remain a single compact row (${JSON.stringify(desktop)})`);
    assert(desktop.contentTop >= desktop.barBottom, `desktop: reader content must clear the floating taskbar (${JSON.stringify(desktop)})`);
    assert.equal(desktop.workspaceBorderTopStyle, "solid", `desktop: the Reader workspace must have a continuous top boundary (${JSON.stringify(desktop)})`);
    assert(desktop.workspaceBorderTopWidth > 0, `desktop: the Reader workspace top boundary must remain visible (${JSON.stringify(desktop)})`);
    assert(desktop.viewportWidth - desktop.sessionRight <= 20, `desktop: the session cluster must hug the top-right corner (${JSON.stringify(desktop)})`);
    assert.equal(desktop.doneDisplay, "none", `desktop: Done ends an agent session — it must never render in the web app (${JSON.stringify(desktop)})`);
    assert.equal(desktop.mainPaddingLeft, 48, `desktop: the established reading gutter must stay at 48px`);
    await page.close();
  } finally {
    await context.close();
  }
}

async function verifyRealChromiumTouches(context, page) {
  const client = await context.newCDPSession(page);
  const surfacePoint = await page.locator("#viewport").evaluate((surface) => {
    for (let y = innerHeight - 36; y >= 100; y -= 36) {
      for (let x = innerWidth - 28; x >= 28; x -= 36) {
        const target = document.elementFromPoint(x, y);
        if (target && surface.contains(target)
          && !target.closest(".node") && !target.closest("#taskbar")) return { x, y };
      }
    }
    return null;
  });
  assert(surfacePoint, "chromium: the real-touch fixture needs visible empty canvas");
  const beforePan = await readCanvasView(page);
  const panDelta = { x: -42, y: -58 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart",
    touchPoints: [{ id: 41, x: surfacePoint.x, y: surfacePoint.y, radiusX: 4, radiusY: 4, force: 1 }] });
  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 41,
      x: surfacePoint.x + panDelta.x * step / 6, y: surfacePoint.y + panDelta.y * step / 6,
      radiusX: 4, radiusY: 4, force: 1 }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const afterPan = await readCanvasView(page);
  assert(Math.abs(afterPan.x - beforePan.x - panDelta.x) < 1
    && Math.abs(afterPan.y - beforePan.y - panDelta.y) < 1,
    `chromium: a physical one-finger drag on empty canvas must pan 1:1 (${JSON.stringify({ beforePan, afterPan })})`);

  const card = await page.locator(".node.root .node-body").evaluate((body) => {
    const rect = body.getBoundingClientRect();
    const left = Math.max(24, rect.left + 24);
    const right = Math.min(innerWidth - 24, rect.right - 24);
    const top = Math.max(90, rect.top + 24);
    const bottom = Math.min(innerHeight - 24, rect.bottom - 24);
    return { left, right, top, bottom, x: (left + right) / 2, y: (top + bottom) / 2 };
  });
  assert(card.right - card.left > 120 && card.bottom - card.top > 120,
    `chromium: the real-touch fixture needs a visible card body (${JSON.stringify(card)})`);

  const beforeScrollView = await readCanvasView(page);
  const beforeScrollTop = await page.locator(".node.root .node-body").evaluate((body) => body.scrollTop);
  const scrollStartY = Math.min(card.bottom - 20, card.y + 60);
  const scrollEndY = Math.max(card.top + 20, scrollStartY - 120);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart",
    touchPoints: [{ id: 42, x: card.x, y: scrollStartY, radiusX: 4, radiusY: 4, force: 1 }] });
  for (let step = 1; step <= 6; step += 1) {
    const y = scrollStartY + (scrollEndY - scrollStartY) * step / 6;
    await client.send("Input.dispatchTouchEvent", { type: "touchMove",
      touchPoints: [{ id: 42, x: card.x, y, radiusX: 4, radiusY: 4, force: 1 }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
  const afterScrollTop = await page.locator(".node.root .node-body").evaluate((body) => body.scrollTop);
  const afterScrollView = await readCanvasView(page);
  assert(afterScrollTop > beforeScrollTop + 30,
    `chromium: a physical one-finger swipe inside a card must scroll it (${beforeScrollTop} -> ${afterScrollTop})`);
  assert(Math.abs(afterScrollView.x - beforeScrollView.x) < 0.01
    && Math.abs(afterScrollView.y - beforeScrollView.y) < 0.01
    && Math.abs(afterScrollView.scale - beforeScrollView.scale) < 0.001,
    `chromium: a physical card swipe must not move the camera`);

  const beforePinch = await readCanvasView(page);
  const centerX = card.x;
  const centerY = card.y;
  const startHalfSpan = Math.min(42, (card.right - card.left) / 4);
  const endHalfSpan = Math.min(65, (card.right - card.left) / 2 - 8);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { id: 51, x: centerX - startHalfSpan, y: centerY, radiusX: 4, radiusY: 4, force: 1 },
    { id: 52, x: centerX + startHalfSpan, y: centerY, radiusX: 4, radiusY: 4, force: 1 },
  ] });
  for (let step = 1; step <= 6; step += 1) {
    const halfSpan = startHalfSpan + (endHalfSpan - startHalfSpan) * step / 6;
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
      { id: 51, x: centerX - halfSpan, y: centerY, radiusX: 4, radiusY: 4, force: 1 },
      { id: 52, x: centerX + halfSpan, y: centerY, radiusX: 4, radiusY: 4, force: 1 },
    ] });
  }
  const afterPinch = await readCanvasView(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert(afterPinch.scale > beforePinch.scale * 1.35,
    `chromium: a physical two-finger spread inside a card must zoom the canvas (${beforePinch.scale} -> ${afterPinch.scale})`);
  const anchorX = (centerX - beforePinch.x) / beforePinch.scale;
  const anchorY = (centerY - beforePinch.y) / beforePinch.scale;
  assert(Math.abs(anchorX * afterPinch.scale + afterPinch.x - centerX) < 1
    && Math.abs(anchorY * afterPinch.scale + afterPinch.y - centerY) < 1,
    `chromium: a physical pinch must keep the content under its midpoint stable`);
  await client.detach();
}

async function readCanvasView(page) {
  return page.locator("#world").evaluate((world) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
}

async function verifyMobileSelectionSurface(browserEngine, engineName) {
  const context = await browserEngine.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  await seedConfiguredOpenRouter(context);
  try {
    const canvasPage = await context.newPage();
    await routeProvider(canvasPage, {
      streams: [["TITLE: Mobile custom branch\n", "Mobile custom question completed."]],
      providerDelayMs: 220,
    });
    await canvasPage.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(canvasPage, "# Mobile selection\n\nLong-press selection should open a reliable action sheet.");

    await canvasPage.evaluate(() => {
      const root = document.querySelector(".node .doc-content[data-node-id]");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.nodeValue.indexOf("Long-press selection");
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + "Long-press selection".length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error("Mobile selection fixture text not found");
    });
    await canvasPage.waitForSelector("#ask.visible.mobile-sheet");

    const initial = await canvasPage.locator("#ask").evaluate((surface) => {
      const rect = surface.getBoundingClientRect();
      const viewport = window.visualViewport;
      const input = document.getElementById("ask-text");
      const lenses = Array.from(surface.querySelectorAll(".lens"));
      return {
        active: document.activeElement?.id || "",
        placement: surface.dataset.placement,
        selection: window.getSelection().toString(),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        viewport: { left: viewport.offsetLeft, right: viewport.offsetLeft + viewport.width, top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height },
        inputFont: parseFloat(getComputedStyle(input).fontSize),
        lensColumns: getComputedStyle(document.getElementById("ask-actions")).gridTemplateColumns.split(" ").length,
        lensMinHeight: Math.min(...lenses.map((lens) => lens.getBoundingClientRect().height)),
        keyHintsHidden: lenses.every((lens) => getComputedStyle(lens.querySelector("kbd")).display === "none"),
      };
    });
    assert.notEqual(initial.active, "ask-text", `${engineName}: mobile selection must not summon the keyboard before the user asks a custom question`);
    assert.equal(initial.placement, "top-center", `${engineName}: mobile selection actions should anchor to the visual viewport bottom`);
    assert.equal(initial.selection, "Long-press selection", `${engineName}: opening the mobile sheet must preserve the selected text`);
    assert(initial.rect.left >= initial.viewport.left && initial.rect.right <= initial.viewport.right, `${engineName}: mobile selection sheet must fit the visual viewport (${JSON.stringify(initial)})`);
    assert(initial.rect.top >= initial.viewport.top && initial.rect.bottom <= initial.viewport.bottom, `${engineName}: mobile selection sheet must stay visible (${JSON.stringify(initial)})`);
    assert(initial.inputFont >= 16, `${engineName}: mobile custom-question input must not trigger iOS focus zoom`);
    assert.equal(initial.lensColumns, 2, `${engineName}: mobile lenses should use a thumb-friendly two-column grid`);
    assert(initial.lensMinHeight >= 44, `${engineName}: mobile lens targets must be at least 44px tall (got ${initial.lensMinHeight})`);
    assert.equal(initial.keyHintsHidden, true, `${engineName}: desktop keyboard shortcut hints should be hidden on touch surfaces`);

    await canvasPage.click("#ask-text");
    await canvasPage.fill("#ask-text", "Why is this reliable?");
    await canvasPage.setViewportSize({ width: 390, height: 430 });
    await canvasPage.waitForFunction(() => {
      const surface = document.getElementById("ask").getBoundingClientRect();
      const viewport = window.visualViewport;
      return document.activeElement?.id === "ask-text" && surface.top >= viewport.offsetTop && surface.bottom <= viewport.offsetTop + viewport.height;
    });
    assert.equal(await canvasPage.evaluate(() => window.visualViewport?.scale), 1, `${engineName}: focusing the mobile question field must not zoom the page`);
    const commitMinHeight = await canvasPage.locator("#ask .ask-commit").evaluateAll((buttons) => Math.min(...buttons.map((button) => button.getBoundingClientRect().height)));
    assert(commitMinHeight >= 44, `${engineName}: mobile Note/Ask targets must be at least 44px tall (got ${commitMinHeight})`);
    assert.deepEqual(await canvasPage.locator("#ask .ask-commit kbd").evaluateAll((chips) => chips.map((chip) => getComputedStyle(chip).display !== "none")),
      [true, true], `${engineName}: mobile commit chips must stay visible`);
    await canvasPage.click('#ask .ask-commit[data-commit="ask"]');
    await canvasPage.waitForSelector("#ask:not(.visible)");
    await canvasPage.locator(".node:not(.root)", { hasText: "Mobile custom question completed." }).waitFor();
    await canvasPage.close();

    // WebKit's automation layer cannot attach a synthetic Selection inside the
    // overflowed reader (native long-press handles are not exposed). Its true-
    // mobile canvas flow above still covers the shared sheet and iOS viewport;
    // Chromium exercises the reader's touchend path end to end below.
    if (engineName === "webkit") return;

    const readerPage = await context.newPage();
    await routeProvider(readerPage, {
      streams: [["TITLE: Mobile lens branch\n", "Mobile lens action completed."]],
      providerDelayMs: 220,
    });
    await readerPage.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(readerPage, "# Mobile reader selection\n\nTouch selection should open a **reliable action sheet**.");
    await readerPage.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
    await readerPage.waitForFunction(() => !document.body.classList.contains("mode-flight"));
    await readerPage.waitForFunction(() => !document.body.classList.contains("mode-canvas"));
    await readerPage.evaluate(() => {
      const node = document.querySelector("#reader-main strong")?.firstChild;
      if (!node) throw new Error("Mobile reader selection fixture text not found");
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      node.parentElement.dispatchEvent(new Event("touchend", { bubbles: true }));
    });
    await readerPage.waitForSelector("#ask.visible.mobile-sheet");
    assert.equal(await readerPage.evaluate(() => window.getSelection().toString()), "reliable action sheet", `${engineName}: reader selection should open the sheet without collapsing the range`);
    const sidebarBranchCount = await readerPage.locator(".side-item").count();
    await readerPage.click('#ask .lens[data-lens="explain"]');
    await readerPage.waitForSelector("#ask:not(.visible)");
    await readerPage.waitForFunction((before) => document.querySelectorAll(".side-item").length > before, sidebarBranchCount);
    await readerPage.waitForFunction(() => Array.from(document.querySelectorAll(".side-item")).some((item) => !item.classList.contains("pending")));
    // Margin notes stay off the phone reading surface, but the note still
    // carries its lens and selected context for wider screens.
    assert.match(await readerPage.locator("#margin-notes .side-item").last().evaluate((tile) => tile.textContent),
      /Explain[\s\S]*reliable action sheet/i, `${engineName}: the reader lens action should retain its lens and selected context`);
    assert(await readerPage.locator("#reader-main mark[data-child]").count() >= 1,
      `${engineName}: the lens branch must leave an inline mark as the phone affordance`);
    await readerPage.close();
  } finally {
    await context.close();
  }
}

async function verifyAnchoredNotes() {
  const context = await browser.newContext();
  await seedConfiguredOpenRouter(context);
  const page = await context.newPage();
  try {
    await routeProvider(page, {
      streams: [
        ["TITLE: Command ask\n", "Command ask completed."],
        ["TITLE: Blank ask\n", "Blank ask completed."],
        ["TITLE: Lens ask\n", "Lens ask completed."],
        ["TITLE: Button ask\n", "Button ask completed."],
      ],
      providerDelayMs: 500,
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, [
      "# Anchored notes",
      "",
      "The first anchor belongs to an Enter-created note.",
      "",
      "The command anchor belongs to a keyboard-created ask.",
      "",
      "The restore anchor checks that clearing the draft restores lenses.",
      "",
      "The lens anchor checks the empty numeric shortcut.",
      "",
      "The typed lens anchor keeps numbers in the textarea.",
      "",
      "The click note anchor uses the labeled Note action.",
      "",
      "The click ask anchor uses the labeled Ask action.",
    ].join("\n"));

    await selectText(page, "first anchor");
    await page.waitForSelector("#ask.visible");
    assert.deepEqual(await composerRowState(page, "#ask"), { lensesVisible: true, commitsHidden: true },
      "an empty anchored popover should rest on the four lenses");
    assert.deepEqual(await page.locator("#ask").evaluate((surface) => ({
      active: document.activeElement?.id,
      hasDraft: surface.classList.contains("has-draft"),
      askHighlight: CSS.highlights?.has("rh-ask") || false,
    })), { active: "ask-text", hasDraft: false, askHighlight: true },
    "an empty anchored popover should focus its input with the selection wash lit");
    await page.fill("#ask-text", "Enter-created marginalia");
    assert.deepEqual(await page.locator("#ask").evaluate((surface) => ({
      hasDraft: surface.classList.contains("has-draft"),
      lensesHidden: Array.from(surface.querySelectorAll(".lens")).every((button) => getComputedStyle(button).display === "none"),
      commits: Array.from(surface.querySelectorAll(".ask-commit")).map((button) => ({
        label: button.childNodes[0].textContent.trim(),
        hint: button.querySelector("kbd")?.textContent,
        visible: getComputedStyle(button).display !== "none",
      })),
      askHighlight: CSS.highlights?.has("rh-ask") || false,
    })), {
      hasDraft: true,
      lensesHidden: true,
      commits: [
        { label: "Note", hint: "↵", visible: true },
        { label: "Ask", hint: "⌘↵", visible: true },
      ],
      askHighlight: true,
    }, "typing should morph the lens row into labeled commit actions while the selection wash stays put");
    await page.keyboard.down("Control");
    await page.keyboard.up("Control");
    assert.equal(await page.evaluate(() => CSS.highlights?.has("rh-ask") || false), true,
      "the selection wash must stay put while typing or holding modifiers");
    const viewBeforeNote = await readCanvasView(page);
    await page.press("#ask-text", "Enter");
    const enterNote = page.locator(".node-note", { hasText: "Enter-created marginalia" });
    await enterNote.waitFor();
    await page.waitForTimeout(350);
    assert.deepEqual(await readCanvasView(page), viewBeforeNote, "creating an anchored note must preserve the exact canvas viewport");
    assert.equal(await enterNote.locator(".node-title").innerText(), "Note", "note cards should use the reducer's default title");
    assert.equal(await page.locator(".node-note-tag").count(), 0, "note cards should rely on their title and tinted header without a separate tag");
    assert.equal(await enterNote.locator(".loading, .stream-status").count(), 0, "notes should appear complete without pending UI");
    assert.equal(await page.locator(".node.root mark.mark-ready.mark-note").count(), 1, "an HTML note should paint note ink on its parent");

    await selectText(page, "command anchor");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "Why is this a command ask?");
    const viewBeforeAsk = await readCanvasView(page);
    await page.press("#ask-text", "Control+Enter");
    const commandAsk = page.locator(".node:not(.root)", { hasText: "Why is this a command ask?" });
    await commandAsk.waitFor();
    await page.waitForTimeout(350);
    assert.notDeepEqual(await readCanvasView(page), viewBeforeAsk, "creating an ask must retain its existing viewport reveal behavior");
    assert.equal(await commandAsk.locator(".loading").count(), 1, "Cmd/Ctrl+Enter should create a pending ask card");

    await selectText(page, "restore anchor");
    await page.waitForSelector("#ask.visible");
    const nodeCountBeforeBlank = await page.locator(".node").count();
    await page.fill("#ask-text", "temporary draft");
    await page.fill("#ask-text", "");
    assert.deepEqual(await composerRowState(page, "#ask"), { lensesVisible: true, commitsHidden: true },
      "emptying the textarea should restore the lenses");
    assert.deepEqual(await page.locator("#ask").evaluate((surface) => ({
      hasDraft: surface.classList.contains("has-draft"),
      askHighlight: CSS.highlights?.has("rh-ask") || false,
    })), { hasDraft: false, askHighlight: true }, "emptying the textarea should restore rest state and ask ink");
    await page.press("#ask-text", "Enter");
    assert.equal(await page.locator(".node").count(), nodeCountBeforeBlank, "blank Enter must be inert");
    assert.equal(await page.locator("#ask.visible").count(), 1, "blank Enter must leave the popover open");
    await page.press("#ask-text", "Control+Enter");
    const blankAsk = page.locator(".node:not(.root)", { has: page.locator(".node-title", { hasText: /^…$/ }) });
    await blankAsk.waitFor();
    assert.equal(await blankAsk.locator(".loading").count(), 1, "blank Cmd/Ctrl+Enter should retain the pending ellipsis ask");

    await selectText(page, "lens anchor");
    await page.waitForSelector("#ask.visible");
    const beforeLens = await page.locator(".node").count();
    await page.press("#ask-text", "1");
    await page.waitForFunction((count) => document.querySelectorAll(".node").length === count + 1, beforeLens);
    const lensState = await page.evaluate(() => window.__rabbitholeTest.readStoredHole());
    assert.equal(lensState.nodes.at(-1).origin?.lens, "explain", "1 should submit the Explain lens while the box is empty");

    await selectText(page, "typed lens anchor");
    await page.waitForSelector("#ask.visible");
    const beforeTypedLens = await page.locator(".node").count();
    await page.fill("#ask-text", "draft");
    await page.press("#ask-text", "1");
    assert.equal(await page.inputValue("#ask-text"), "draft1", "lens number keys should type normally once the box is non-empty");
    assert.equal(await page.locator(".node").count(), beforeTypedLens, "a lens key must not submit while text is present");
    await page.keyboard.press("Escape");

    await selectText(page, "click note anchor");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "Button-created marginalia");
    await page.click('#ask .ask-commit[data-commit="note"]');
    await page.locator(".node-note", { hasText: "Button-created marginalia" }).waitFor();

    await selectText(page, "click ask anchor");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "Button-created ask");
    await page.click('#ask .ask-commit[data-commit="ask"]');
    await page.locator(".node:not(.root)", { hasText: "Button-created ask" }).waitFor();

    await page.waitForFunction(async () => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.filter((node) => node.origin?.kind === "note").length === 2;
    });
    const persisted = await page.evaluate(() => window.__rabbitholeTest.readStoredHole());
    const notes = persisted.nodes.filter((node) => node.origin?.kind === "note");
    assert.deepEqual(notes.map((node) => ({ title: node.title, markdown: node.markdown, status: node.status, read: node.read, selected: node.origin.selected_text })), [
      { title: "Note", markdown: "Enter-created marginalia", status: "answered", read: true, selected: "first anchor" },
      { title: "Note", markdown: "Button-created marginalia", status: "answered", read: true, selected: "click note anchor" },
    ], "node_create should persist both complete anchored notes");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".node-note");
    assert.equal(await page.locator(".node-note").count(), 2, "persisted notes should hydrate as note cards");
    assert.equal(await page.locator(".node.root mark.mark-note").count(), 2, "persisted HTML note marks should rebuild on hydration");
    console.log("ok web app: anchored morphing actions, commit keys, honest preview, HTML note ink, and persistence");
  } finally {
    await context.close();
  }
}

async function verifyStandaloneNotesAndEditing() {
  const context = await browser.newContext();
  await seedConfiguredOpenRouter(context);
  const page = await context.newPage();
  let providerCalls = 0;
  await routeProvider(page, {
    onProviderCall: () => { providerCalls += 1; },
    providerDelayMs: 220,
    streams: [[
      "TITLE: Standalone canvas ask\n",
      "The standalone two-intent composer reached the existing provider path.",
    ]],
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, [
      "# Phase 3 notes",
      "",
      "This anchored edit target becomes durable marginalia.",
      "",
      "Double-clicking this document must never create a standalone note.",
    ].join("\n"));
    assert.equal(await page.locator("#t-frame").count(), 0, "zoom-to-fit must not have a toolbar surface");

    await selectText(page, "anchored edit target");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "Original anchored note");
    await page.click('#ask .ask-commit[data-commit="note"]');
    const anchored = page.locator(".node-note", { hasText: "Original anchored note" });
    await anchored.waitFor();
    const anchoredId = await anchored.getAttribute("data-id");
    const anchoredCard = page.locator(`.node-note[data-id="${anchoredId}"]`);
    const rootCard = page.locator(".node.root");
    const rootId = await rootCard.getAttribute("data-id");
    await page.waitForTimeout(350);

    const persistedNoteCount = async () => page.evaluate(async () => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.filter((node) => node.origin?.kind === "note").length;
    });
    assert.equal(await persistedNoteCount(), 1);

    const noteTitle = anchoredCard.locator(".node-title");
    await noteTitle.dblclick({ position: { x: 5, y: 8 } });
    const noteTitleEditing = await noteTitle.evaluate((title) => ({ editable: title.getAttribute("contenteditable"),
      isEditable: title.isContentEditable, active: document.activeElement === title,
      mode: document.body.className }));
    assert.equal(noteTitleEditing.editable, "plaintext-only", `a note title should become editable in place (${JSON.stringify(noteTitleEditing)})`);
    assert(await page.locator("body.mode-canvas").count(), "renaming a title must not trigger the header's reader dive");
    await noteTitle.fill("Renamed note window");
    await noteTitle.press("Enter");
    assert.equal(await noteTitle.innerText(), "Renamed note window", "Enter should commit an inline note title rename");

    const rootTitle = rootCard.locator(".node-title");
    const originalRootTitle = await rootTitle.innerText();
    await rootTitle.dblclick({ position: { x: 5, y: 8 } });
    await rootTitle.fill("Discard this root title");
    await rootTitle.press("Escape");
    assert.equal(await rootTitle.innerText(), originalRootTitle, "Escape should cancel an inline title rename");
    await rootTitle.dblclick({ position: { x: 5, y: 8 } });
    await rootTitle.fill("   ");
    await rootTitle.press("Enter");
    assert.equal(await rootTitle.innerText(), originalRootTitle, "an empty trimmed title should keep the old title");
    await rootTitle.dblclick({ position: { x: 5, y: 8 } });
    await rootTitle.fill("Renamed answer window");
    await rootTitle.press("Tab");
    assert.equal(await rootTitle.innerText(), "Renamed answer window", "blur should commit a non-note title rename");
    await page.waitForFunction(async ({ rootId, anchoredId }) => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.find((node) => node.id === rootId)?.title === "Renamed answer window"
        && hole.nodes.find((node) => node.id === anchoredId)?.title === "Renamed note window";
    }, { rootId, anchoredId });

    await page.locator(".node.root .doc-content p").last().dblclick({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(80);
    assert.equal(await page.locator(".node-note").count(), 1, "double-clicking a card must not create a note");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    await page.locator(".node.root mark.mark-note").dblclick();
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".node-note").count(), 1, "double-clicking a mark must not create a note");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    const anchoredSurface = anchoredCard.locator(".doc-content");
    const renderedStyle = await anchoredSurface.evaluate((surface) => {
      const style = getComputedStyle(surface);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        color: style.color, backgroundColor: style.backgroundColor, padding: style.padding };
    });
    await anchoredSurface.click({ position: { x: 8, y: 8 } });
    assert.equal(await anchoredCard.locator(".note-editor").count(), 0, "a single note-body click should remain ordinary document interaction");
    const clickedWordBox = await anchoredSurface.evaluate((surface) => {
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent.indexOf("anchored");
        if (idx === -1) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + "anchored".length);
        const rect = range.getBoundingClientRect();
        const host = surface.getBoundingClientRect();
        return { x: rect.left - host.left + rect.width / 2, y: rect.top - host.top + rect.height / 2 };
      }
      return null;
    });
    assert(clickedWordBox, "the rendered note should contain the word targeted for caret placement");
    await anchoredSurface.dblclick({ position: clickedWordBox });
    const anchoredEditor = anchoredCard.locator(".note-editor");
    await anchoredEditor.waitFor();
    assert.equal(await anchoredEditor.evaluate((editor) => editor.classList.contains("doc-content")), false,
      "the note editor must not participate in document selection handling");
    const editorSurface = await anchoredEditor.evaluate((editor) => {
      const style = getComputedStyle(editor);
      return { visual: { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        color: style.color, backgroundColor: style.backgroundColor, padding: style.padding },
        border: style.borderTopWidth, outline: style.outlineStyle, shadow: style.boxShadow,
        caret: [editor.selectionStart, editor.selectionEnd, editor.value.length] };
    });
    assert.deepEqual(editorSurface.visual, renderedStyle, "the markdown-source editor should inherit the rendered document surface exactly");
    assert.deepEqual({ border: editorSurface.border, outline: editorSurface.outline, shadow: editorSurface.shadow },
      { border: "0px", outline: "none", shadow: "none" }, "the note editor should add no box or focus chrome");
    const editorValue = await anchoredEditor.inputValue();
    const clickedWordStart = editorValue.indexOf("anchored");
    assert.equal(editorSurface.caret[0], editorSurface.caret[1], "double-click editing should leave a collapsed caret, not a selection");
    assert(editorSurface.caret[0] >= clickedWordStart && editorSurface.caret[0] <= clickedWordStart + "anchored".length,
      `double-click editing should place the caret at the clicked point in the markdown source (caret ${editorSurface.caret[0]}, word at ${clickedWordStart})`);
    await anchoredEditor.fill("Edited anchored **durably**");
    await anchoredEditor.press("Control+Enter");
    await anchoredCard.locator(".doc-content strong", { hasText: "durably" }).waitFor();
    await page.waitForFunction(async () => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.some((node) => node.origin?.kind === "note" && node.markdown === "Edited anchored **durably**");
    });
    const assertEditedStored = async (label) => {
      const markdown = await page.evaluate(async (id) => (await window.__rabbitholeTest.readStoredHole()).nodes.find((node) => node.id === id)?.markdown, anchoredId);
      assert.equal(markdown, "Edited anchored **durably**", label);
    };
    await page.waitForTimeout(1000);
    await assertEditedStored("the edited note must remain durable after pending saves settle");

    let point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForSelector(".node-note .note-editor");
    assert.equal(await page.locator(".node-note").count(), 2, "double-click should register one ephemeral note card");
    await page.waitForTimeout(260);
    const clickSpawn = await page.locator(".node-note:has(.note-editor)").evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    assert(Math.abs(clickSpawn.left - point.x) < 2 && Math.abs(clickSpawn.top - point.y) < 2,
      `a canvas double-click should place the note's top-left at the click (${JSON.stringify({ clickSpawn, point })})`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".node-note").length === 1);
    assert.equal(await persistedNoteCount(), 1, "Escape must leave no persisted empty note");
    assert.equal(await page.locator(".node.note-draft").count(), 0, "empty-draft Escape must leave zero draft nodes");

    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    const deletableDraft = page.locator(".node.note-draft");
    await deletableDraft.waitFor();
    const deletableDraftId = await deletableDraft.getAttribute("data-id");
    assert.equal(await deletableDraft.locator(".node-collapse").count(), 1,
      "the draft retains its structural collapse button for committed-card reuse");
    assert.equal(await deletableDraft.locator(".node-collapse").isVisible(), false,
      "collapse must be hidden while a card is an ephemeral draft");
    await deletableDraft.locator(".node-btn.danger").click();
    await page.waitForSelector(`.node[data-id="${deletableDraftId}"]`, { state: "detached" });
    assert.equal(await page.locator("#branch-undo.visible").count(), 0,
      "deleting an ephemeral draft must discard immediately without an undo toast");
    assert.equal(await persistedNoteCount(), 1, "deleting an ephemeral draft must not create persistence traffic");

    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForSelector(".node-note .note-editor");
    await page.click("#t-theme");
    await page.waitForFunction(() => document.querySelectorAll(".node-note").length === 1);
    assert.equal(await persistedNoteCount(), 1, "blur while empty must leave no persisted note");

    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    const standaloneEditor = page.locator(".node-note .note-editor");
    await standaloneEditor.waitFor();
    const standaloneCard = page.locator(".node-note:has(.note-editor)");
    assert.deepEqual(await standaloneCard.evaluate((card) => {
      const editor = card.querySelector(".note-editor");
      return {
        width: card.offsetWidth,
        height: card.offsetHeight,
        maxHeight: parseFloat(card.style.maxHeight),
        active: document.activeElement === editor,
        caret: [editor.selectionStart, editor.selectionEnd, editor.value.length],
        lenses: card.querySelectorAll(".lens").length,
        collapseVisible: getComputedStyle(card.querySelector(".node-collapse")).display !== "none",
        commits: Array.from(card.querySelectorAll(".ask-commit")).map((button) => ({
          commit: button.dataset.commit,
          title: button.title,
          hint: button.querySelector("kbd")?.textContent,
          disabled: button.disabled,
          visible: getComputedStyle(button).display !== "none",
        })),
      };
    }), {
      width: 300,
      height: 180,
      maxHeight: 460,
      active: true,
      caret: [0, 0, 0],
      lenses: 0,
      collapseVisible: false,
      commits: [
        { commit: "note", title: "Save note", hint: undefined, disabled: true, visible: true },
        { commit: "ask", title: "Ask (Command/Control+Enter)", hint: "⌘↵", disabled: true, visible: true },
      ],
    }, "standalone drafts should start compact and focused with honest disabled commit actions but no lenses");
    await standaloneEditor.press("1");
    assert.equal(await standaloneEditor.inputValue(), "1", "a lens-less standalone composer must type 1 as ordinary text");
    await standaloneEditor.fill("Standalone note survives reload");
    assert.deepEqual(await standaloneCard.locator(".ask-commit").evaluateAll((buttons) => buttons.map((button) => button.disabled)), [false, false],
      "typing should enable both standalone commit intents exactly like card composers");
    await standaloneCard.locator('.ask-commit[data-commit="note"]').click();
    await page.locator(".node-note .doc-content", { hasText: "Standalone note survives reload" }).waitFor();
    await page.waitForFunction(async () => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.some((node) => node.parent_id === null && node.origin?.kind === "note" && node.markdown === "Standalone note survives reload");
    });

    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    const askDraft = page.locator(".node.note-draft");
    const askEditor = askDraft.locator(".note-editor");
    await askEditor.fill("How does the standalone Ask intent work?");
    const askDraftState = await askDraft.evaluate((card) => {
      card.__standaloneAskIdentity = true;
      const rect = card.getBoundingClientRect();
      return {
        id: card.dataset.id,
        nodeCount: document.querySelectorAll(".node").length,
        edgeCount: document.querySelectorAll("#edges path").length,
        transform: getComputedStyle(document.getElementById("world")).transform,
        position: { x: parseFloat(card.style.left), y: parseFloat(card.style.top) },
        size: { w: card.offsetWidth, h: card.offsetHeight },
        screen: { left: rect.left, top: rect.top, width: rect.width },
      };
    });
    await askDraft.locator('.ask-commit[data-commit="ask"]').click();
    const standaloneAsk = page.locator(`.node[data-id="${askDraftState.id}"]`);
    await page.waitForFunction((id) => {
      const card = document.querySelector(`.node[data-id="${id}"]`);
      return card && !card.classList.contains("note-draft") && card.textContent.includes("Thinking");
    }, askDraftState.id);
    const pendingAskState = await standaloneAsk.evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return {
        sameCard: card.__standaloneAskIdentity === true,
        nodeCount: document.querySelectorAll(".node").length,
        edgeCount: document.querySelectorAll("#edges path").length,
        ownEdges: document.querySelectorAll(`#edges [data-child="${card.dataset.id}"]`).length,
        transform: getComputedStyle(document.getElementById("world")).transform,
        screen: { left: rect.left, top: rect.top, width: rect.width },
        noteClass: card.classList.contains("node-note"),
        text: card.textContent,
      };
    });
    assert.equal(pendingAskState.sameCard, true, "Ask commit must morph the exact draft DOM card into its pending answer surface");
    assert.equal(pendingAskState.nodeCount, askDraftState.nodeCount, "Ask commit must not replace the draft with a second node");
    assert.equal(pendingAskState.edgeCount, askDraftState.edgeCount, "a standalone Ask commit must add zero graph edges");
    assert.equal(pendingAskState.ownEdges, 0, "a standalone Ask must never acquire an edge element");
    assert.equal(pendingAskState.transform, askDraftState.transform, "committing a standalone Ask must not move the viewport");
    assert.deepEqual(pendingAskState.screen, askDraftState.screen, "the pending ask must keep the draft's exact screen position and width");
    assert.equal(pendingAskState.noteClass, false, "the in-place pending surface is an ask card, not a committed note");
    assert.match(pendingAskState.text, /How does the standalone Ask intent work\?/);
    await page.waitForFunction(async ({ id, position, size }) => {
      const stored = (await window.__rabbitholeTest.readStoredHole()).nodes.find((node) => node.id === id);
      return stored?.status === "pending" && stored.parent_id === null
        && stored.position.x === position.x && stored.position.y === position.y
        && stored.size.w === size.w && stored.size.h === size.h;
    }, { id: askDraftState.id, position: askDraftState.position, size: askDraftState.size });
    await standaloneAsk.filter({ hasText: "The standalone two-intent composer reached the existing provider path." }).waitFor();
    assert.equal(providerCalls, 1, "the standalone Ask action should call the configured provider exactly once");
    assert.equal(await page.locator(".node.note-draft").count(), 0, "Ask commit should consume the ephemeral note surface");
    assert.deepEqual(await standaloneAsk.evaluate((card) => ({
      sameCard: card.__standaloneAskIdentity === true,
      edgeCount: document.querySelectorAll("#edges path").length,
      ownEdges: document.querySelectorAll(`#edges [data-child="${card.dataset.id}"]`).length,
      transform: getComputedStyle(document.getElementById("world")).transform,
    })), {
      sameCard: true,
      edgeCount: askDraftState.edgeCount,
      ownEdges: 0,
      transform: askDraftState.transform,
    }, "the streamed answer must settle in the same disconnected card without moving the camera");
    await page.waitForFunction(async ({ id, position, size }) => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.some((node) => node.id === id && node.parent_id === null
        && node.origin?.question === "How does the standalone Ask intent work?"
        && node.origin?.selected_text === "" && node.origin?.branch_type === "followup"
        && node.position.x === position.x && node.position.y === position.y
        && node.size.w === size.w && node.size.h === size.h
        && node.markdown.includes("existing provider path"));
    }, { id: askDraftState.id, position: askDraftState.position, size: askDraftState.size });

    await page.keyboard.press("Control+K");
    await page.fill("#pal-text", "intent work");
    await page.locator(".pal-item:visible", { hasText: "Standalone canvas ask" }).waitFor();
    await page.keyboard.press("Escape");

    await standaloneAsk.locator('.node-btn[aria-label="Collapse card"]').click();
    assert.equal(await standaloneAsk.evaluate((card) => card.classList.contains("collapsed")), true,
      "standalone asks must use the ordinary collapse path");
    await standaloneAsk.locator(".node-btn.danger").click();
    await page.waitForSelector(`.node[data-id="${askDraftState.id}"]`, { state: "detached" });
    await page.locator("#branch-undo [data-notice-action]").click();
    const restoredStandaloneAsk = page.locator(`.node[data-id="${askDraftState.id}"]`);
    await restoredStandaloneAsk.waitFor();
    assert.equal(await restoredStandaloneAsk.evaluate((card) => card.classList.contains("collapsed")), true,
      "delete undo must restore a parentless ask's collapsed state");
    assert.equal(await page.locator(`#edges [data-child="${askDraftState.id}"]`).count(), 0,
      "delete undo must keep the restored standalone ask disconnected");
    await restoredStandaloneAsk.locator('.node-btn[aria-label="Expand card"]').click();

    const beforeTidy = await restoredStandaloneAsk.evaluate((card) => ({ left: card.style.left, top: card.style.top }));
    await page.click("#t-tidy");
    await page.waitForTimeout(320);
    assert.deepEqual(await restoredStandaloneAsk.evaluate((card) => ({ left: card.style.left, top: card.style.top })), beforeTidy,
      "Tidy must leave parentless asks in place just as it leaves standalone notes");

    await page.waitForTimeout(300);
    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    const growthCard = page.locator(".node.note-draft");
    const growthEditor = growthCard.locator(".note-editor");
    await growthEditor.waitFor();
    const growthStart = await growthCard.evaluate((card) => {
      const rect = card.getBoundingClientRect();
      const row = card.querySelector(".ask-actions").getBoundingClientRect();
      return { top: rect.top, height: card.offsetHeight, rowHeight: row.height, rowBottomGap: rect.bottom - row.bottom };
    });
    await growthEditor.fill(Array.from({ length: 12 }, (_, index) => `Growing line ${index + 1}`).join("\n"));
    const growthMiddle = await growthCard.evaluate((card) => {
      const rect = card.getBoundingClientRect();
      const row = card.querySelector(".ask-actions").getBoundingClientRect();
      return { top: rect.top, height: card.offsetHeight, rowHeight: row.height, rowBottomGap: rect.bottom - row.bottom };
    });
    assert(growthMiddle.height > growthStart.height && growthMiddle.height < 460,
      `typing should grow the card between its compact start and standard cap (${JSON.stringify({ growthStart, growthMiddle })})`);
    assert(Math.abs(growthMiddle.top - growthStart.top) < 0.5,
      `type-to-grow must keep the draft card's top-left fixed (${JSON.stringify({ growthStart, growthMiddle })})`);
    assert(Math.abs(growthMiddle.rowHeight - growthStart.rowHeight) < 0.5
      && Math.abs(growthMiddle.rowBottomGap - growthStart.rowBottomGap) < 0.5,
    "the shared commit row must stay pinned without reflow while the card grows");
    await growthEditor.fill(Array.from({ length: 80 }, (_, index) => `Capped line ${index + 1}`).join("\n"));
    const growthCap = await growthCard.evaluate((card) => {
      const rect = card.getBoundingClientRect();
      const row = card.querySelector(".ask-actions").getBoundingClientRect();
      const editor = card.querySelector(".note-editor");
      return { top: rect.top, height: card.offsetHeight, cap: parseFloat(card.style.maxHeight),
        rowHeight: row.height, rowBottomGap: rect.bottom - row.bottom,
        editorClientHeight: editor.clientHeight, editorScrollHeight: editor.scrollHeight,
        editorOverflow: getComputedStyle(editor).overflowY };
    });
    assert.equal(growthCap.height, growthCap.cap, "the draft card should stop exactly at the standard card height cap");
    assert(growthCap.editorScrollHeight > growthCap.editorClientHeight && growthCap.editorOverflow === "auto",
      `content beyond the card cap should scroll inside the editor (${JSON.stringify(growthCap)})`);
    assert(Math.abs(growthCap.top - growthStart.top) < 0.5, "capped growth must still preserve the card's top edge");
    assert(Math.abs(growthCap.rowHeight - growthStart.rowHeight) < 0.5
      && Math.abs(growthCap.rowBottomGap - growthStart.rowBottomGap) < 0.5,
    "the commit footer must keep its geometry at the growth cap");
    await growthEditor.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".node.note-draft"));
    assert.equal(await persistedNoteCount(), 2, "cancelling a grown draft must create no persistence traffic");

    await page.keyboard.press("Control+K");
    await page.waitForSelector("#palette:not([hidden])");
    const commands = await page.locator(".pal-item").evaluateAll((rows) => rows.map((row) => row.querySelector(".pal-title")?.textContent));
    assert(commands.includes("New note"), "the canvas palette should expose New note");
    assert(commands.includes("Zoom to fit"), "the canvas palette should expose Zoom to fit");
    assert(commands.includes("Increase reading size") && commands.includes("Decrease reading size") && commands.includes("Reset reading size"),
      "the canvas palette should expose the global reading-size commands");
    const zoomCommand = page.locator(".pal-item", { hasText: "Zoom to fit" });
    assert.equal(await zoomCommand.locator("kbd:visible").count(), 0, "Zoom to fit must not advertise the deleted global F shortcut");
    await page.keyboard.press("Escape");

    await ensureRailOpen(page);
    const visibleCenter = await page.evaluate(() => {
      const rail = document.getElementById("web-rail");
      const taskbar = document.getElementById("taskbar");
      const viewport = document.getElementById("viewport");
      const fullW = viewport.clientWidth || innerWidth;
      const fullH = viewport.clientHeight || innerHeight;
      const insetX = rail.classList.contains("open") ? rail.getBoundingClientRect().width : 0;
      const insetY = taskbar.getBoundingClientRect().height;
      return { x: insetX + (fullW - insetX) / 2, y: insetY + (fullH - insetY) / 2 };
    });
    await page.keyboard.press("Control+K");
    await page.fill("#pal-text", "New note");
    await page.press("#pal-text", "Enter");
    await page.waitForFunction(() => document.activeElement?.classList.contains("note-editor"));
    assert.equal(await page.locator("#palette:visible").count(), 0, "New note must close the palette before focusing its editor");
    await page.waitForTimeout(260);
    const paletteCardCenter = await page.locator(".node-note:has(.note-editor)").evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    assert(Math.abs(paletteCardCenter.x - visibleCenter.x) < 2 && Math.abs(paletteCardCenter.y - visibleCenter.y) < 2,
      `palette notes should center in the rail-adjusted viewport (${JSON.stringify({ paletteCardCenter, visibleCenter })})`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".node-note").length === 2);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".node-note", { state: "attached" });
    const reloadedNoteText = await page.locator(".node-note .doc-content").evaluateAll((docs) => docs.map((dc) => dc.textContent).join(" "));
    assert(reloadedNoteText.includes("Edited anchored durably") && reloadedNoteText.includes("Standalone note survives reload"),
      `committed note markdown should hydrate after reload (${JSON.stringify(reloadedNoteText)})`);
    assert.equal(await page.locator(`.node[data-id="${anchoredId}"] .node-title`).innerText(), "Renamed note window",
      "a renamed note title should survive reload");
    assert.equal(await page.locator(`.node[data-id="${rootId}"] .node-title`).innerText(), "Renamed answer window",
      "a renamed non-note title should survive reload");
    assert.equal(await page.locator(".node-note").count(), 2, "only committed notes should survive reload");
    console.log("ok web app: top-left note spawn, seamless double-click editing, all-node title renames, and persistence");
  } finally {
    await context.close();
  }
}

async function verifyStandaloneImagePaste() {
  const context = await browser.newContext();
  await seedConfiguredOpenRouter(context);
  const page = await context.newPage();
  const providerBodies = [];
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    window.__revokedObjectUrls = [];
    URL.revokeObjectURL = (url) => { window.__revokedObjectUrls.push(String(url)); revoke(url); };
  });
  await routeProvider(page, {
    onProviderCall: (body) => providerBodies.push(body),
    providerDelayMs: 350,
    streams: [["TITLE: Pasted image answer\n", "The pasted image reached the provider."]],
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, "# Clipboard images\n\nPaste images into a standalone canvas composer.");
    const assets = () => page.evaluate(() => window.__rabbitholeTest.inspectAssets());
    assert.deepEqual((await assets()).names, []);

    let point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    let draft = page.locator(".node.note-draft");
    let editor = draft.locator(".note-editor");
    const removableDraftId = await draft.getAttribute("data-id");
    assert.equal(await pasteSyntheticImage(editor, "remove.png", "#d55"), true, "an image paste should be consumed");
    const removablePreview = draft.locator(".paste-attachment img");
    await removablePreview.waitFor();
    assert.equal(await editor.evaluate((textarea) => document.activeElement === textarea), true,
      "normalizing and rendering a pasted attachment must preserve editor focus");
    assert.equal(await draft.evaluate((card) => card.classList.contains("note-draft")), true,
      "paste busy states must never auto-commit the ephemeral draft");
    assert.equal(await page.evaluate(async (id) => (await window.__rabbitholeTest.readStoredHole()).nodes.some((node) => node.id === id), removableDraftId), false,
      "a pasted attachment must remain uncommitted until Note or Ask is explicitly chosen");
    const removableUrl = await removablePreview.getAttribute("src");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".node.note-draft .ask-commit")).every((button) => !button.disabled));
    assert.deepEqual(await draft.locator(".ask-commit").evaluateAll((buttons) => buttons.map((button) => button.disabled)), [false, false],
      "an image-only draft should enable Note and Ask");
    assert.deepEqual((await assets()).names, [], "pasting and previewing must not upload an asset");
    await draft.locator(".paste-attachment-remove").click();
    await page.waitForFunction(() => !document.querySelector(".paste-attachment"));
    assert.equal(await page.evaluate((url) => window.__revokedObjectUrls.includes(url), removableUrl), true,
      "removing a preview should revoke its object URL");
    assert.deepEqual(await draft.locator(".ask-commit").evaluateAll((buttons) => buttons.map((button) => button.disabled)), [true, true]);
    await editor.press("Escape");

    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    draft = page.locator(".node.note-draft");
    editor = draft.locator(".note-editor");
    assert.equal(await pasteSyntheticImage(editor, "note.png", "#4a8"), true);
    await draft.locator(".paste-attachment img").waitFor();
    await draft.locator('.ask-commit[data-commit="note"]:not(:disabled)').waitFor();
    await draft.locator('.ask-commit[data-commit="note"]').evaluate((button) => button.click());
    const imageNote = page.locator(".node-note", { has: page.locator(".doc-content img") }).last();
    await imageNote.locator(".rh-img-frame img").waitFor();
    const imageNoteId = await imageNote.getAttribute("data-id");
    const editableImageNote = page.locator(`.node-note[data-id="${imageNoteId}"]`);
    assert.equal(await imageNote.locator(".rh-img-handle").count(), 1, "committed pasted-note images should receive resize UX");
    await imageNote.locator(".rh-img-frame img").evaluate((image) => image.click());
    await page.locator(".rh-lightbox").waitFor();
    await page.keyboard.press("Escape");
    const noteAssets = await assets();
    assert.equal(noteAssets.names.length, 1, "an attachment-only Note commit should upload exactly one asset");
    const noteAsset = noteAssets.names[0];
    assert.match(noteAsset, /^paste-[a-f0-9-]+\.png$/);
    assert.equal(await page.evaluate(async (name) => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return hole.nodes.some((node) => node.origin?.kind === "note"
        && node.markdown === `![Pasted image](asset:${name})`);
    }, noteAsset), true, "the note should persist an image ref even with empty text");

    const committedSurface = editableImageNote.locator(".doc-content");
    await committedSurface.dispatchEvent("dblclick", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
    let reentryEditor = editableImageNote.locator(".note-editor");
    await reentryEditor.waitFor();
    await reentryEditor.evaluate((textarea) => textarea.setSelectionRange(textarea.value.length, textarea.value.length));
    assert.equal(await pasteSyntheticImage(reentryEditor, "reentry-save.png", "#ea4"), true,
      "a committed-note editor should consume image paste");
    await page.waitForFunction((id) => {
      const editor = document.querySelector(`.node[data-id="${id}"] .note-editor`);
      return editor && /\n\n!\[Pasted image\]\(asset:paste-[a-f0-9-]+\.png\)$/.test(editor.value);
    }, imageNoteId);
    const savedEditMarkdown = await reentryEditor.inputValue();
    const savedEditAsset = savedEditMarkdown.match(/asset:(paste-[a-f0-9-]+\.png)\)$/)?.[1];
    assert(savedEditAsset, "the pasted image link should be inserted at the caret as its own paragraph");
    await reentryEditor.evaluate((textarea) => textarea.blur());
    await editableImageNote.locator('.doc-content img[data-rh-pasted="1"]').nth(1).waitFor({ state: "attached" });
    await page.waitForFunction(async ({ id, markdown }) => {
      const node = (await window.__rabbitholeTest.readStoredHole()).nodes.find((entry) => entry.id === id);
      return node?.markdown === markdown;
    }, { id: imageNoteId, markdown: savedEditMarkdown });
    assert((await assets()).names.includes(savedEditAsset), "blur-save should retain the newly referenced edit-session asset");

    await editableImageNote.locator(".doc-content").dispatchEvent("dblclick", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
    reentryEditor = editableImageNote.locator(".note-editor");
    await reentryEditor.waitFor();
    const assetsBeforeCancel = (await assets()).names;
    assert.equal(await pasteSyntheticImage(reentryEditor, "reentry-cancel.png", "#b5d"), true);
    await page.waitForFunction((count) => window.__rabbitholeTest.inspectAssets().then((result) => result.names.length === count + 1), assetsBeforeCancel.length);
    const cancelledMarkdown = await reentryEditor.inputValue();
    assert.equal(Array.from(cancelledMarkdown.matchAll(/asset:paste-[a-f0-9-]+\.png/g)).length, 3,
      "the cancel case should finish inserting its newly uploaded image before rollback");
    await reentryEditor.press("Escape");
    await editableImageNote.locator(".doc-content").waitFor();
    await page.waitForFunction((expected) => window.__rabbitholeTest.inspectAssets().then((result) =>
      JSON.stringify(result.names) === JSON.stringify(expected)), assetsBeforeCancel);
    assert.equal(await editableImageNote.locator(".doc-content img").count(), 2,
      "Escape should restore the saved note without the cancelled pasted image");

    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    draft = page.locator(".node.note-draft");
    editor = draft.locator(".note-editor");
    assert.equal(await pasteSyntheticImage(editor, "ask.png", "#58c"), true);
    await draft.locator(".paste-attachment img").waitFor();
    await draft.locator('.ask-commit[data-commit="ask"]:not(:disabled)').waitFor();
    const askId = await draft.getAttribute("data-id");
    await draft.locator('.ask-commit[data-commit="ask"]').evaluate((button) => button.click());
    const imageAsk = page.locator(`.node[data-id="${askId}"]`);
    await imageAsk.locator(".origin-quote .origin-attachment-strip img").waitFor();
    assert.equal(await imageAsk.locator(".node-title").innerText(), "Pasted image", "an image-only ask should use the fallback title");
    await page.waitForFunction(() => document.querySelector(".node .origin-attachment-strip img"));
    await page.waitForTimeout(30);
    assert.equal(providerBodies.length, 1);
    const userContent = providerBodies[0].messages.find((message) => message.role === "user").content;
    assert.deepEqual(userContent.map((part) => part.type), ["text", "image_url"],
      "the BYOK provider request should contain the pasted image part");
    assert.match(userContent[1].image_url.url, /^data:image\/png;base64,/);
    await imageAsk.filter({ hasText: "The pasted image reached the provider." }).waitFor();
    assert.equal(await imageAsk.locator(".origin-quote .origin-attachment-strip img").count(), 1,
      "the question thumbnail should remain after the ask is answered");
    const storedAsk = await page.evaluate(async (id) => (await window.__rabbitholeTest.readStoredHole()).nodes.find((node) => node.id === id), askId);
    assert.equal(storedAsk.origin.question, "");
    assert.equal(storedAsk.origin.attachment_assets.length, 1);

    const beforeDiscard = await assets();
    point = await findCanvasBackground(page);
    await page.mouse.dblclick(point.x, point.y);
    draft = page.locator(".node.note-draft");
    editor = draft.locator(".note-editor");
    assert.equal(await pasteSyntheticImage(editor, "discard.png", "#a6c"), true);
    const discardedPreview = draft.locator(".paste-attachment img");
    await discardedPreview.waitFor();
    const discardedUrl = await discardedPreview.getAttribute("src");
    assert.deepEqual((await assets()).names, beforeDiscard.names, "an uncommitted pasted image must remain memory-only");
    await editor.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".node.note-draft"));
    assert.equal(await page.evaluate((url) => window.__revokedObjectUrls.includes(url), discardedUrl), true,
      "discarding the composer should revoke its preview URL");
    assert.deepEqual((await assets()).names, beforeDiscard.names, "discarding must leave no uploaded asset behind");
    console.log("ok web app: standalone clipboard images preview, remove, Note, Ask, provider delivery, and discard");
  } finally {
    await context.close();
  }
}

async function pasteSyntheticImage(editor, fileName, color) {
  return editor.evaluate(async (textarea, { fileName, color }) => {
    textarea.focus();
    const canvas = document.createElement("canvas"); canvas.width = 12; canvas.height = 8;
    const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], fileName, { type: "image/png" }));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
    if (!event.clipboardData) Object.defineProperty(event, "clipboardData", { value: transfer });
    const consumed = !textarea.dispatchEvent(event);
    return consumed;
  }, { fileName, color });
}

async function verifyLogicalMarkGrouping() {
  const context = await browser.newContext();
  await seedConfiguredOpenRouter(context);
  const page = await context.newPage();
  let providerCalls = 0;
  await routeProvider(page, {
    keyStatus: () => 200,
    onProviderCall: () => { providerCalls += 1; },
    streams: [
      ["TITLE: Grouped mark branch\n", "The answer reached from every fragment of the grouped mark."],
      ["TITLE: Overlapping mark branch\n", "The nested answer proves overlapping mark discovery."],
      ["TITLE: Unrelated mark branch\n", "A separate answer used to prove hover isolation."],
    ],
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, [
      "# Logical mark groups",
      "",
      "This paragraph begins before the grouped selection and continues through a distinctive phrase.",
      "",
      "- This list item carries the selection through its unmistakable ending.",
      "",
      "A separate paragraph contains an unrelated anchor for isolation.",
    ].join("\n"));

    await selectAcrossBlocks(page, "grouped selection", "unmistakable ending");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "Why should this whole range highlight?");
    await page.click('#ask .ask-commit[data-commit="ask"]');
    const groupedCanvasMark = page.locator('.node.root mark[aria-label="Open branch: Grouped mark branch"].mark-ready');
    await groupedCanvasMark.first().waitFor();
    const groupedId = await groupedCanvasMark.first().getAttribute("data-child");

    await selectText(page, "distinctive phrase");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "How does this overlap the larger range?");
    await page.click('#ask .ask-commit[data-commit="ask"]');
    const overlappingCanvasMark = page.locator('.node.root mark[aria-label="Open branch: Overlapping mark branch"].mark-ready');
    await overlappingCanvasMark.waitFor();
    const overlappingId = await overlappingCanvasMark.getAttribute("data-child");

    await selectText(page, "unrelated anchor");
    await page.waitForSelector("#ask.visible");
    await page.fill("#ask-text", "Why is this mark separate?");
    await page.click('#ask .ask-commit[data-commit="ask"]');
    const unrelatedCanvasMark = page.locator('.node.root mark[aria-label="Open branch: Unrelated mark branch"].mark-ready');
    await unrelatedCanvasMark.waitFor();
    const unrelatedId = await unrelatedCanvasMark.getAttribute("data-child");
    assert.equal(providerCalls, 3, "the mark-group fixture should create its grouped, overlapping, and unrelated branches");

    const blockCoverage = await groupedCanvasMark.evaluateAll((marks) => ({
      count: marks.length,
      blocks: [...new Set(marks.map((mark) => mark.closest("p, li")?.tagName).filter(Boolean))],
    }));
    assert(blockCoverage.count >= 2, `the cross-block selection must render at least two mark fragments: ${JSON.stringify(blockCoverage)}`);
    assert(blockCoverage.blocks.includes("P") && blockCoverage.blocks.includes("LI"),
      `the grouped mark must span paragraph and list-item ancestors: ${JSON.stringify(blockCoverage)}`);

    assert.equal(await overlappingCanvasMark.evaluate((mark, parentId) => {
      let ancestor = mark.parentElement;
      while (ancestor && !ancestor.classList.contains("doc-content")) {
        if (ancestor.matches("mark[data-child]") && ancestor.dataset.child === parentId) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    }, groupedId), true, "the overlapping fixture must render as a nested logical mark");
    await exerciseOverlappingMarkHover(page, groupedId, overlappingId, unrelatedId);
    await exerciseGroupedMarkHover(page, ".node.root .doc-content", groupedId, unrelatedId, true);

    await page.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
    await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
    await page.waitForSelector("body:not(.mode-canvas) #reader-main");
    await exerciseGroupedMarkHover(page, "#reader-main .doc-content", groupedId, unrelatedId, false);
    const readerMarks = page.locator(`#reader-main mark[data-child="${groupedId}"]`);
    await page.keyboard.press("Shift");
    await readerMarks.nth(1).focus();
    await assertStrongMarkGroup(page, "#reader-main .doc-content", groupedId, unrelatedId, "Reader DOM focus");
    assert.equal(await readerMarks.evaluateAll((marks) => marks.every((mark) => mark.classList.contains("mark-dom-focus"))), true,
      "Reader DOM focus must apply its state to every fragment in the logical group");
    assert.notEqual(await readerMarks.nth(1).evaluate((mark) => getComputedStyle(mark).outlineStyle), "none",
      "the actually focused Reader fragment must retain its visible focus ring");

    await page.evaluate(() => document.getElementById("reader-restore").click());
    await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
    await page.waitForSelector("body.mode-canvas");
    await verifyNonFirstFragmentCanvasNavigation(page, groupedId);

    const frozenHtml = await page.evaluate(() => window.__rabbitholeTest.exportSnapshot());
    const frozenPage = await context.newPage();
    await frozenPage.setContent(frozenHtml, { waitUntil: "load" });
    await frozenPage.waitForSelector(".node.root .doc-content");
    await frozenPage.waitForSelector("body.mode-canvas");
    await exerciseGroupedMarkHover(frozenPage, ".node.root .doc-content", groupedId, unrelatedId, true);
    await verifyNonFirstFragmentCanvasNavigation(frozenPage, groupedId);
    await frozenPage.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
    await frozenPage.waitForFunction(() => !document.body.classList.contains("mode-flight"));
    await frozenPage.waitForSelector("body:not(.mode-canvas) #reader-main");
    await exerciseGroupedMarkHover(frozenPage, "#reader-main .doc-content", groupedId, unrelatedId, false);
    const frozenReaderMarks = frozenPage.locator(`#reader-main mark[data-child="${groupedId}"]`);
    await frozenPage.keyboard.press("Shift");
    await frozenReaderMarks.nth(1).focus();
    await assertStrongMarkGroup(frozenPage, "#reader-main .doc-content", groupedId, unrelatedId, "frozen Reader DOM focus");
    assert.notEqual(await frozenReaderMarks.nth(1).evaluate((mark) => getComputedStyle(mark).outlineStyle), "none",
      "the focused frozen Reader fragment must retain its visible focus ring");
    await frozenPage.close();
  } finally {
    await context.close();
  }
}

async function exerciseOverlappingMarkHover(page, groupedId, overlappingId, unrelatedId) {
  const overlapping = page.locator(`.node.root mark[data-child="${overlappingId}"]`).first();
  await overlapping.hover();
  await page.waitForFunction(({ groupedId, overlappingId }) => {
    const marks = [...document.querySelectorAll(".node.root .doc-content mark[data-child]")];
    const active = marks.filter((mark) => mark.dataset.child === groupedId || mark.dataset.child === overlappingId);
    return active.length >= 3 && active.every((mark) => mark.classList.contains("mark-hover"));
  }, { groupedId, overlappingId });
  const state = await page.evaluate(({ groupedId, overlappingId, unrelatedId }) => {
    const marks = [...document.querySelectorAll(".node.root .doc-content mark[data-child]")];
    return {
      grouped: marks.filter((mark) => mark.dataset.child === groupedId).every((mark) => mark.classList.contains("mark-hover")),
      overlapping: marks.filter((mark) => mark.dataset.child === overlappingId).every((mark) => mark.classList.contains("mark-hover")),
      unrelated: marks.filter((mark) => mark.dataset.child === unrelatedId).some((mark) => mark.classList.contains("mark-hover")),
    };
  }, { groupedId, overlappingId, unrelatedId });
  assert.deepEqual(state, { grouped: true, overlapping: true, unrelated: false },
    "hovering a nested mark must activate every represented logical group without affecting unrelated marks");
  await page.locator("#t-theme").hover();
  assert.equal(await page.locator(".node.root .doc-content mark.mark-hover").count(), 0,
    "leaving nested marks must clear every represented logical group");
}

async function exerciseGroupedMarkHover(page, scope, groupedId, unrelatedId, expectEdge) {
  const marks = page.locator(`${scope} mark[data-child="${groupedId}"]`);
  const last = marks.nth((await marks.count()) - 1);
  await marks.first().hover();
  await assertStrongMarkGroup(page, scope, groupedId, unrelatedId, "mark hover");
  assert.equal(await marks.evaluateAll((fragments) => fragments.every((mark) => mark.classList.contains("mark-hover"))), true,
    "hovering one fragment must apply mark-hover to its whole logical group");
  if (expectEdge) assert.equal(await edgeHighlightState(page, groupedId), true,
    "Canvas mark hover must highlight the matching branch edge");

  await marks.first().evaluate((first) => {
    const root = first.closest(".doc-content");
    const peers = [...root.querySelectorAll("mark[data-child]")].filter((mark) => mark.dataset.child === first.dataset.child);
    first.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: peers[peers.length - 1] }));
  });
  assert.equal(await marks.evaluateAll((fragments) => fragments.every((mark) => mark.classList.contains("mark-hover"))), true,
    "moving directly between fragments of one logical mark must preserve group hover state");
  if (expectEdge) assert.equal(await edgeHighlightState(page, groupedId), true,
    "moving within one logical mark must preserve its Canvas edge highlight");
  await last.hover();
  await assertStrongMarkGroup(page, scope, groupedId, unrelatedId, "mark hover after an intra-group move");

  await page.locator("#t-theme").hover();
  await page.waitForFunction(({ scope, groupedId, unrelatedId }) => {
    const root = document.querySelector(scope);
    const marks = [...root.querySelectorAll("mark[data-child]")];
    const group = marks.filter((mark) => mark.dataset.child === groupedId)
      .map((mark) => getComputedStyle(mark).backgroundColor);
    const unrelated = marks.find((mark) => mark.dataset.child === unrelatedId);
    const normal = unrelated && getComputedStyle(unrelated).backgroundColor;
    return group.length > 0 && group.every((color) => color === normal);
  }, { scope, groupedId, unrelatedId });
  const cleared = await readMarkBackgrounds(page, scope, groupedId, unrelatedId);
  assert.equal(cleared.group.every((color) => color === cleared.unrelated), true,
    `leaving the logical mark must restore every fragment's normal background: ${JSON.stringify(cleared)}`);
  assert.equal(await marks.evaluateAll((fragments) => fragments.every((mark) => !mark.classList.contains("mark-hover"))), true,
    "leaving the logical mark must clear group hover state");
  if (expectEdge) assert.equal(await edgeHighlightState(page, groupedId), false,
    "leaving a Canvas logical mark must clear its branch edge highlight");
}

async function assertStrongMarkGroup(page, scope, groupedId, unrelatedId, label) {
  await page.waitForFunction(({ scope, groupedId, unrelatedId }) => {
    const root = document.querySelector(scope);
    const marks = [...root.querySelectorAll("mark[data-child]")];
    const group = marks.filter((mark) => mark.dataset.child === groupedId)
      .map((mark) => getComputedStyle(mark).backgroundColor);
    const unrelated = marks.find((mark) => mark.dataset.child === unrelatedId);
    const normal = unrelated && getComputedStyle(unrelated).backgroundColor;
    return group.length >= 2 && group.every((color) => color === group[0]) && group[0] !== normal;
  }, { scope, groupedId, unrelatedId });
  const state = await readMarkBackgrounds(page, scope, groupedId, unrelatedId);
  assert(state.group.length >= 2, `${label}: the fixture must expose multiple fragments`);
  assert.equal(state.group.every((color) => color === state.group[0]), true,
    `${label}: every logical fragment must receive the same strong background: ${JSON.stringify(state)}`);
  assert.notEqual(state.group[0], state.unrelated,
    `${label}: an unrelated mark must retain its normal background: ${JSON.stringify(state)}`);
}

async function readMarkBackgrounds(page, scope, groupedId, unrelatedId) {
  return page.evaluate(({ scope, groupedId, unrelatedId }) => {
    const root = document.querySelector(scope);
    const marks = [...root.querySelectorAll("mark[data-child]")];
    const group = marks.filter((mark) => mark.dataset.child === groupedId)
      .map((mark) => getComputedStyle(mark).backgroundColor);
    const unrelated = marks.find((mark) => mark.dataset.child === unrelatedId);
    return { group, unrelated: unrelated && getComputedStyle(unrelated).backgroundColor };
  }, { scope, groupedId, unrelatedId });
}

async function edgeHighlightState(page, childId) {
  return page.evaluate((id) => {
    const edge = [...document.querySelectorAll("#edges path[data-child]")]
      .find((path) => path.dataset.child === id);
    return !!edge && edge.classList.contains("edge-hl");
  }, childId);
}

async function verifyNonFirstFragmentCanvasNavigation(page, childId) {
  const marks = page.locator(`.node.root mark[data-child="${childId}"]`);
  const nonFirst = marks.nth((await marks.count()) - 1);
  const armFlashProbe = () => page.evaluate(() => {
    window.__logicalMarkDiveFlashed = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector(".node:not(.root).flash")) {
        window.__logicalMarkDiveFlashed = true;
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("world"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });

  await armFlashProbe();
  await nonFirst.click();
  await page.waitForFunction(() => window.__logicalMarkDiveFlashed === true);
  assert.equal(await page.evaluate(() => document.body.classList.contains("mode-canvas")), true,
    "clicking a non-first mark fragment must dive to the branch in Canvas");
  await page.waitForTimeout(400);
  await zoomToFit(page);
  await page.waitForTimeout(400);

  await nonFirst.focus();
  await armFlashProbe();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__logicalMarkDiveFlashed === true);
  assert.equal(await page.evaluate(() => document.body.classList.contains("mode-canvas")), true,
    "pressing Enter on a non-first mark fragment must dive to the branch in Canvas");
  await page.waitForTimeout(400);
  await zoomToFit(page);
  await page.waitForTimeout(400);
}

async function verifyCanvasBranching() {
  const context = await browser.newContext();
  await seedConfiguredOpenRouter(context);
  const page = await context.newPage();
  const requests = [];
  let providerCalls = 0;
  page.on("request", (request) => requests.push(request.url()));
  await routeProvider(page, {
    keyStatus: () => 200,
    onProviderCall: () => { providerCalls += 1; },
    streams: [
      [
        "TITLE: Card follow-up\n",
        "Card drawer keyboard submission created this follow-up child.",
      ],
      [
        "TITLE: Euler branch\n",
        "Euler identity connects rotation, growth, and zero in one compact statement.\n\n",
        "```show\n<style>.flow{display:grid;gap:8px}.box{border:1px solid var(--border);padding:8px;border-radius:6px}</style><div class='flow'><div class='box'>rotation</div><div class='box'>cancellation</div></div>\n```\n",
      ],
      [
        "TITLE: Deeper link\n",
        "Second branch explains the geometric view: multiplication by $e^{i\\theta}$ rotates a point on the complex plane.",
      ],
    ],
    providerDelayMs: 220,
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#composer-modal[hidden]", { state: "attached" });
  await page.click("#t-settings");
  await page.waitForTimeout(140);
  const toolbarAlignment = await page.evaluate(() => {
    const settings = document.getElementById("t-settings").getBoundingClientRect();
    const theme = document.getElementById("t-theme").getBoundingClientRect();
    return { settingsTop: settings.top, themeTop: theme.top, settingsHeight: settings.height, themeHeight: theme.height };
  });
  assert(Math.abs(toolbarAlignment.settingsTop - toolbarAlignment.themeTop) < 0.5, "settings control should align with toolbar peers");
  assert.equal(toolbarAlignment.settingsHeight, toolbarAlignment.themeHeight, "settings control should match toolbar peer height");
  const settingsPlacement = await page.evaluate(() => {
    const button = document.getElementById("t-settings").getBoundingClientRect();
    const dialog = document.querySelector(".web-settings-dialog").getBoundingClientRect();
    const styles = getComputedStyle(document.documentElement);
    const edge = parseFloat(styles.getPropertyValue("--surface-edge"));
    const gap = parseFloat(styles.getPropertyValue("--surface-gap"));
    return {
      rightAlignment: Math.abs(dialog.right - button.right),
      leftEdge: dialog.left,
      triggerGap: dialog.top - button.bottom,
      edge,
      gap,
      withinViewport: dialog.left >= edge && dialog.right <= innerWidth - edge && dialog.top >= edge && dialog.bottom <= innerHeight - edge,
    };
  });
  assert(settingsPlacement.rightAlignment < 1 || Math.abs(settingsPlacement.leftEdge - settingsPlacement.edge) < 1,
    `settings panel should anchor to its gear or the safe page edge, right offset ${settingsPlacement.rightAlignment.toFixed(2)}px, left ${settingsPlacement.leftEdge.toFixed(2)}px`);
  assert(Math.abs(settingsPlacement.triggerGap - settingsPlacement.gap) < 1, `settings panel should use the token gap from its trigger, got ${settingsPlacement.triggerGap.toFixed(2)}px`);
  assert.equal(settingsPlacement.withinViewport, true, "settings panel should stay within the viewport");
  await page.evaluate(() => {
    const trigger = document.getElementById("t-settings");
    trigger.style.position = "fixed";
    trigger.style.bottom = "8px";
    trigger.style.right = "14px";
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(50);
  const flipped = await page.evaluate(() => {
    const trigger = document.getElementById("t-settings").getBoundingClientRect();
    const dialog = document.querySelector(".web-settings-dialog").getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--surface-gap"));
    return { placement: document.querySelector(".web-settings-dialog").dataset.placement, gap: trigger.top - dialog.bottom, tokenGap: gap };
  });
  assert.equal(flipped.placement, "top-end", "settings should flip above when below-space cannot fit the rendered surface");
  assert(Math.abs(flipped.gap - flipped.tokenGap) < 1, "flipped settings should preserve the token gap");
  await page.evaluate(() => {
    document.getElementById("t-settings").removeAttribute("style");
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(50);
  const growthBefore = await page.locator(".web-settings-dialog").boundingBox();
  await page.evaluate(() => {
    const growth = document.createElement("div");
    growth.id = "anchor-growth-probe";
    growth.style.height = "120px";
    document.getElementById("settings-panel").appendChild(growth);
  });
  await page.waitForTimeout(50);
  const growthAfter = await page.evaluate(() => {
    const dialog = document.querySelector(".web-settings-dialog").getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--surface-edge"));
    return { top: dialog.top, height: dialog.height, bottom: dialog.bottom, limit: innerHeight - edge };
  });
  assert(growthAfter.height > growthBefore.height || growthAfter.top < growthBefore.y,
    "content growth should resize or reposition the measured settings surface");
  assert(growthAfter.bottom <= growthAfter.limit + 1, "content growth should re-clamp settings within the token edge");
  await page.evaluate(() => document.getElementById("anchor-growth-probe").remove());
  const settingsSurfaceStandard = await page.evaluate(() => {
    const styles = getComputedStyle(document.querySelector(".web-settings-dialog"));
    return {
      background: styles.backgroundColor,
      border: styles.border,
      radius: styles.borderRadius,
      shadow: styles.boxShadow,
      backdrop: styles.backdropFilter,
    };
  });
  const gearOffset = await page.evaluate(() => {
    const button = document.getElementById("t-settings");
    const glyph = button.querySelector("svg");
    const box = glyph.getBBox();
    const ctm = glyph.getScreenCTM();
    const cx = ctm.a * (box.x + box.width / 2) + ctm.c * (box.y + box.height / 2) + ctm.e;
    const cy = ctm.b * (box.x + box.width / 2) + ctm.d * (box.y + box.height / 2) + ctm.f;
    const rect = button.getBoundingClientRect();
    return { dx: cx - (rect.left + rect.width / 2), dy: cy - (rect.top + rect.height / 2) };
  });
  assert(Math.abs(gearOffset.dx) < 0.25 && Math.abs(gearOffset.dy) < 0.25,
    `settings gear glyph should be optically centered in its button, off by ${gearOffset.dx.toFixed(2)},${gearOffset.dy.toFixed(2)}px`);
  assert.match(await page.locator("#settings-panel").innerText(), /Connected|Stored only in this browser/i);
  assert.equal(await page.locator("#model-select").count(), 1, "settings should expose one model picker");
  assert.equal(await page.locator(".settings-advanced").count(), 0, "OpenRouter settings should not duplicate model choices or expose link-relay plumbing");
  assert.deepEqual(await page.evaluate(() => ["api-key"].map((id) => {
    const input = document.getElementById(id);
    const label = document.querySelector(`label[for="${id}"]`);
    const described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    return { id, named: !!label?.textContent.trim(), described: described.length > 0 && described.every((ref) => !!document.getElementById(ref)) };
  })), [
    { id: "api-key", named: true, described: true },
  ], "OpenRouter key should have a label and connected status");
  assert.equal(await page.getAttribute("#api-key-status", "aria-live"), "polite", "API key Field status should remain a polite live region");
  await page.click("#api-key");
  const pointerFieldFocus = await page.evaluate(() => ({
    outline: getComputedStyle(document.getElementById("api-key")).outlineStyle,
    halo: getComputedStyle(document.querySelector(".key-input-wrap")).boxShadow,
  }));
  assert.equal(pointerFieldFocus.outline, "none", "pointer-focused fields should not show the keyboard ring");
  assert.notEqual(pointerFieldFocus.halo, "none", "composite field focus should show the field halo");
  await page.locator("#api-key-toggle").focus();
  await page.keyboard.press("Shift+Tab");
  const keyboardFieldFocus = await page.evaluate(() => ({
    focused: document.activeElement?.id,
    outline: getComputedStyle(document.getElementById("api-key")).outlineStyle,
    halo: getComputedStyle(document.querySelector(".key-input-wrap")).boxShadow,
  }));
  assert.equal(keyboardFieldFocus.focused, "api-key");
  assert.notEqual(keyboardFieldFocus.outline, "none", "keyboard-focused fields should show the focus-visible ring");
  assert.notEqual(keyboardFieldFocus.halo, "none", "keyboard-focused composite fields should retain the field halo");
  await page.click("#model-select");
  await page.waitForSelector("#model-select-listbox");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#model-select-listbox").count(), 0, "first Escape should close only the nested model combobox");
  assert.equal(await page.locator("#web-settings-popover").getAttribute("hidden"), null, "settings should remain open after its child closes");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#web-settings-popover", { state: "detached" });
  assert.equal(await page.locator("#web-settings-popover").count(), 0, "outside pointer must remove the settings surface from the DOM");
  assert.equal(await page.getAttribute("#t-settings", "aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "t-settings", "closing settings should restore focus to its trigger");
  await page.click("#t-settings");
  await page.waitForSelector("#web-settings-popover");
  await page.click("#t-settings");
  await page.waitForSelector("#web-settings-popover", { state: "detached" });
  assert.equal(await page.getAttribute("#t-settings", "aria-expanded"), "false", "clicking the gear while settings is open must close it");
  await page.click("#t-settings");
  await page.waitForSelector("#web-settings-popover");
  await page.mouse.click(4, 300);
  await page.waitForSelector("#web-settings-popover", { state: "detached" });
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "t-settings", "outside-pointer close should restore settings focus");
  await page.click("#t-settings");
  await page.fill("#api-key", MOCK_KEY);
  await page.press("#api-key", "Enter");
  await page.waitForSelector("#api-key-status.valid");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#web-settings-popover", { state: "detached" });

  const smokeCode = "console.log('math branch');";
  const markdown = [
    "# Web Smoke",
    "",
    "Euler identity $e^{i\\pi}+1=0$ ties exponentials to geometry.",
    "",
    "```js",
    smokeCode,
    "```",
    "",
    "```show",
    "<style>.flow{display:grid;gap:8px}.box{border:1px solid var(--border);padding:8px;border-radius:6px}</style>",
    "<div class='flow'><div class='box'>Select</div><div class='box' style='background:var(--hl)'>Ask</div></div>",
    "```",
    ...Array.from({ length: 12 }, (_, index) => [
      "",
      `## Reading position ${index + 1}`,
      "A deliberately long section keeps both reading surfaces scrollable so mode transitions can preserve the same semantic location.",
    ].join("\n")),
  ].join("\n");

  await createDocument(page, markdown);
  await page.waitForSelector(".node .katex");
  await page.waitForSelector(".node .hljs");
  await page.waitForSelector(".node .viz-show");
  await assertCodeCopy(page, { scope: ".node.root .doc-content", rawCode: smokeCode, label: "web Canvas" });

  const rootDrawer = page.locator(".node.root .nc-handle");
  const rootDrawerId = await rootDrawer.getAttribute("aria-controls");
  assert.equal(await rootDrawer.getAttribute("aria-expanded"), "false", "card drawer handle should expose its closed disclosure state");
  assert(rootDrawerId, "card drawer handle should reference its input region");
  assert.equal(await page.locator(`#${rootDrawerId}`).count(), 1, "card drawer aria-controls should resolve to the input region");
  const canvasModeBeforeDrawer = await page.locator("body").getAttribute("class");
  await rootDrawer.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.matches(".node.root .nc-inner textarea"));
  assert.equal(await rootDrawer.getAttribute("aria-expanded"), "true", "opening a card drawer should expand its disclosure state");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.matches(".node.root .nc-handle"));
  assert.equal(await rootDrawer.getAttribute("aria-expanded"), "false", "Escape should close the card drawer disclosure");
  assert.equal(await page.locator("body").getAttribute("class"), canvasModeBeforeDrawer, "drawer Escape should not change the canvas mode class");
  await rootDrawer.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.matches(".node.root .nc-inner textarea"));
  await page.evaluate(() => document.querySelector(".node.root").matches = () => false);
  await page.focus("#t-theme");
  await page.waitForFunction(() => !document.querySelector(".node.root .node-composer").classList.contains("open"));
  await page.evaluate(() => delete document.querySelector(".node.root").matches);
  assert.equal(await rootDrawer.getAttribute("aria-expanded"), "false", "empty-draft blur should close an unhovered card drawer");

  await rootDrawer.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.matches(".node.root .nc-inner textarea"));
  await page.keyboard.type("Create a card follow-up child");
  await page.keyboard.press("Control+Enter");
  await waitForCanvasText(page, "Card drawer keyboard submission created this follow-up child");
  assert.equal(await rootDrawer.getAttribute("aria-expanded"), "false", "submitting a card follow-up should close its drawer");
  assert.equal(providerCalls, 1, "card Cmd/Ctrl+Enter should use the follow-up request path once");

  const childCard = page.locator(".node:not(.root)", { hasText: "Card drawer keyboard submission" }).first();
  const cardControls = await childCard.locator(".node-head .node-btn").evaluateAll((buttons) => buttons.map((button) => ({
    type: button.getAttribute("type"),
    name: button.getAttribute("aria-label") || button.textContent.trim(),
  })));
  assert.deepEqual(cardControls, [
    { type: "button", name: "Remove this branch" },
    { type: "button", name: "Collapse card" },
    { type: "button", name: "Expand document" },
  ], "card headers should keep only branch, collapse, and document controls");
  await childCard.locator('.node-btn[aria-label="Collapse card"]').click();
  assert.equal(await childCard.evaluate((card) => card.classList.contains("collapsed")), true, "the branch fixture should collapse");
  assert.equal(await childCard.locator(".node-font-btn").count(), 0, "a collapsed card header must not expose font controls");
  await childCard.locator('.node-btn[aria-label="Expand card"]').click();
  const childPosition = await childCard.evaluate((card) => ({ left: card.style.left, top: card.style.top }));
  const collapseBox = await childCard.locator('.node-btn[aria-label="Collapse card"]').boundingBox();
  await page.mouse.move(collapseBox.x + collapseBox.width / 2, collapseBox.y + collapseBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(collapseBox.x + 50, collapseBox.y + 40);
  await page.mouse.up();
  assert.deepEqual(await childCard.evaluate((card) => ({ left: card.style.left, top: card.style.top })), childPosition, "card controls should remain excluded from card dragging");
  await page.keyboard.press("Control+K");
  await page.fill("#pal-text", "Increase reading size");
  await page.press("#pal-text", "Enter");
  assert.deepEqual(await page.locator(".node .doc-content").evaluateAll((docs) => docs.map((doc) => parseFloat(getComputedStyle(doc).fontSize))), [15, 15],
    "one reading-size command should update every card document together");
  assert.equal(await page.evaluate(() => localStorage.getItem("rh-reading-scale")), "1.1", "the global reading size should persist locally");
  assert((await page.evaluate(() => window.__rabbitholeTest.exportPortable())).hole.nodes.every((node) => node.font_scale === 1),
    "global reading size must not rewrite per-card document data");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".node:not(.root)");
  assert.deepEqual(await page.locator(".node .doc-content").evaluateAll((docs) => docs.map((doc) => parseFloat(getComputedStyle(doc).fontSize))), [15, 15],
    "the saved global reading size should apply when the Rabbithole reloads");
  await page.keyboard.press("Control+K");
  await page.fill("#pal-text", "Reset reading size");
  await page.press("#pal-text", "Enter");
  assert.deepEqual(await page.locator(".node .doc-content").evaluateAll((docs) => docs.map((doc) => parseFloat(getComputedStyle(doc).fontSize))), [14, 14],
    "resetting reading size should restore every card document together");
  assert.equal(await page.evaluate(() => localStorage.getItem("rh-reading-scale")), null, "resetting reading size should clear the saved override");
  await childCard.locator(".node-btn.danger").click();
  await childCard.waitFor({ state: "detached" });
  await page.waitForSelector("#branch-undo.visible");
  assert.match(await page.locator("#branch-undo").innerText(), /Branch removed\s+Undo/, "removing a branch should immediately offer one undo action");

  const canvasReadingPosition = await page.evaluate(() => {
    const scroller = document.querySelector(".node.root .node-body");
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.4;
    const top = scroller.getBoundingClientRect().top;
    const blocks = Array.from(scroller.querySelector(".doc-content").children);
    const block = blocks.findIndex((item) => item.getBoundingClientRect().bottom > top);
    const rect = blocks[block].getBoundingClientRect();
    return { block, offset: (top - rect.top) / rect.height };
  });
  await page.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  await page.waitForSelector("body:not(.mode-canvas)");
  assert.deepEqual(await page.evaluate(() => {
    const restore = document.getElementById("reader-restore");
    const home = document.querySelector("#breadcrumb .crumb-canvas");
    return {
      restoreName: restore.getAttribute("aria-label"),
      restoreShown: getComputedStyle(restore).display !== "none",
      homeRole: home.getAttribute("role"),
      homeText: home.textContent.trim(),
    };
  }), { restoreName: "Back to canvas", restoreShown: true, homeRole: "link", homeText: "Canvas" },
  "the reader should expose the mirrored restore control and lead its trail with the canvas");
  const readerReadingPosition = await page.locator("#reader-main").evaluate((scroller) => {
    const top = scroller.getBoundingClientRect().top;
    const blocks = Array.from(scroller.querySelector(".doc-content").children);
    const block = blocks.findIndex((item) => item.getBoundingClientRect().bottom > top);
    const rect = blocks[block].getBoundingClientRect();
    return { block, offset: (top - rect.top) / rect.height };
  });
  assert.equal(readerReadingPosition.block, canvasReadingPosition.block, "canvas-to-reader should preserve the visible content block");
  assert(Math.abs(readerReadingPosition.offset - canvasReadingPosition.offset) < 0.2, `canvas-to-reader should preserve the position within the visible block: ${JSON.stringify({ canvasReadingPosition, readerReadingPosition })}`);
  await assertCodeCopy(page, { scope: "#reader-main .doc-content", rawCode: smokeCode, hover: false, label: "web Reader" });
  await page.focus("#r-textup");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "reader-restore", "reader tools should tab straight into the session cluster, Back to canvas first");
  const readerFocusRing = await page.evaluate(() => getComputedStyle(document.getElementById("reader-restore")).outlineStyle);
  assert.notEqual(readerFocusRing, "none", "keyboard focus should show the taskbar focus-visible ring");
  const readerReturnPosition = await page.locator("#reader-main").evaluate((scroller) => {
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.35;
    const top = scroller.getBoundingClientRect().top;
    const blocks = Array.from(scroller.querySelector(".doc-content").children);
    const block = blocks.findIndex((item) => item.getBoundingClientRect().bottom > top);
    const rect = blocks[block].getBoundingClientRect();
    return { block, offset: (top - rect.top) / rect.height };
  });
  await page.focus("#reader-restore");
  await page.keyboard.press("Enter");
  await page.waitForSelector("body.mode-canvas");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Expand document",
    "keyboard restore should hand focus to the mirrored expand control on the current card");
  await page.waitForTimeout(50);
  const canvasReturnPosition = await page.locator(".node.root .node-body").evaluate((scroller) => {
    const top = scroller.getBoundingClientRect().top;
    const blocks = Array.from(scroller.querySelector(".doc-content").children);
    const block = blocks.findIndex((item) => item.getBoundingClientRect().bottom > top);
    const rect = blocks[block].getBoundingClientRect();
    return { block, offset: (top - rect.top) / rect.height };
  });
  assert.equal(canvasReturnPosition.block, readerReturnPosition.block, "reader-to-canvas should preserve the visible content block");
  assert(Math.abs(canvasReturnPosition.offset - readerReturnPosition.offset) < 0.2, `reader-to-canvas should preserve the position within the visible block: ${JSON.stringify({ readerReturnPosition, canvasReturnPosition })}`);
  await assertCodeCopy(page, { scope: ".node.root .doc-content", rawCode: smokeCode, hover: false, label: "web Canvas after Reader" });
  // Quick Look: Space expands the current card, Escape collapses it back.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Space");
  await page.waitForSelector("body:not(.mode-canvas)");
  await page.keyboard.press("Escape");
  await page.waitForSelector("body.mode-canvas");

  await page.focus("#t-share");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#sharemenu.visible");
  await page.waitForFunction(() => document.activeElement?.id === "sm-trail");
  await page.waitForTimeout(130);
  const shareStandard = await page.evaluate(() => {
    const menu = document.getElementById("sharemenu");
    const anchor = document.getElementById("t-share").getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const styles = getComputedStyle(menu);
    const rootStyles = getComputedStyle(document.documentElement);
    const itemStyles = getComputedStyle(menu.querySelector(".sm-item"));
    return {
      surface: {
        background: styles.backgroundColor,
        border: styles.border,
        radius: styles.borderRadius,
        shadow: styles.boxShadow,
        backdrop: styles.backdropFilter,
      },
      rightAlignment: Math.abs(menuRect.right - anchor.right),
      triggerGap: menuRect.top - anchor.bottom,
      tokenGap: parseFloat(rootStyles.getPropertyValue("--surface-gap")),
      shellPadding: styles.padding,
      itemPaddingTop: itemStyles.paddingTop,
      itemPaddingBottom: itemStyles.paddingBottom,
      expanded: document.getElementById("t-share").getAttribute("aria-expanded"),
      menuItems: menu.querySelectorAll('[role="menuitem"]').length,
    };
  });
  assert.deepEqual(shareStandard.surface, settingsSurfaceStandard, "Share and Settings should use the same popover surface standard");
  assert(shareStandard.rightAlignment < 1, `Share should anchor to its trigger, off by ${shareStandard.rightAlignment.toFixed(2)}px`);
  assert(Math.abs(shareStandard.triggerGap - shareStandard.tokenGap) < 1, `Share should use the token gap from its trigger, got ${shareStandard.triggerGap.toFixed(2)}px`);
  assert.equal(shareStandard.shellPadding, "6px");
  assert.equal(shareStandard.itemPaddingTop, "8px");
  assert.equal(shareStandard.itemPaddingBottom, "8px");
  assert.equal(shareStandard.expanded, "true");
  assert.equal(shareStandard.menuItems, 4);
  assert.deepEqual(await page.locator('#sharemenu [role="menuitem"]').evaluateAll((items) => items.map((item) => item.tabIndex)), [0, -1, -1, -1], "Share should expose one item in the Tab sequence");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "sm-portable", "ArrowUp should wrap to the last visible Share item");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "sm-trail", "ArrowDown should wrap to the first visible Share item");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "sm-portable");
  await page.keyboard.press("Home");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "sm-trail");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#sharemenu:not(.visible)", { state: "attached" });
  await page.waitForFunction(() => document.activeElement?.id === "t-share").catch(() => {
    assert.fail("Enter should activate the focused Share item and restore its trigger");
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "sm-trail");
  await page.keyboard.press("Tab");
  await page.waitForSelector("#sharemenu:not(.visible)", { state: "attached" });
  assert.equal(await page.locator("#sharemenu:focus-within").count(), 0, "Tab should close Share and continue outside the menu");
  await page.focus("#t-share");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "sm-trail");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#sharemenu:not(.visible)", { state: "attached" });
  assert.equal(await page.getAttribute("#t-share", "aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "t-share", "closing Share should restore focus to its trigger");

  const frozenHtml = await page.evaluate(() => window.__rabbitholeTest.exportSnapshot());
  assert(frozenHtml.includes("#taskbar"), "web-exported snapshots should embed durable canvas styling");
  assert(frozenHtml.includes(".katex"), "web-exported snapshots should embed self-contained KaTeX styling");
  assert(!frozenHtml.includes(".web-rail"), "web-exported snapshots must exclude web-only rail styling");
  const frozenPage = await context.newPage();
  await frozenPage.setContent(frozenHtml, { waitUntil: "load" });
  await assertCodeCopy(frozenPage, { scope: ".node.root .doc-content", rawCode: smokeCode, hover: false, label: "web frozen snapshot" });
  const frozenStyles = await frozenPage.evaluate(() => ({
    surfaceGap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--surface-gap")),
    toolbarPosition: getComputedStyle(document.getElementById("taskbar")).position,
  }));
  assert(frozenStyles.surfaceGap > 0, "web-exported snapshots should preserve positive shared surface spacing");
  assert.equal(frozenStyles.toolbarPosition, "fixed", "web-exported snapshots should apply structural toolbar styling");
  await frozenPage.focus("#t-share");
  await frozenPage.keyboard.press("Enter");
  await frozenPage.waitForSelector("#sharemenu.visible");
  await frozenPage.waitForFunction(() => document.activeElement?.id === "sm-trail");
  assert.deepEqual(await frozenPage.locator('#sharemenu [role="menuitem"]:visible').evaluateAll((items) => items.map((item) => item.id)), ["sm-trail", "sm-doc"], "Frozen Share should suppress export and portable export");
  assert.deepEqual(await frozenPage.locator('#sharemenu [role="menuitem"]').evaluateAll((items) => items.map((item) => ({ id: item.id, tabIndex: item.tabIndex, visible: item.style.display !== "none" }))), [
    { id: "sm-trail", tabIndex: 0, visible: true },
    { id: "sm-doc", tabIndex: -1, visible: true },
    { id: "sm-export", tabIndex: -1, visible: false },
    { id: "sm-portable", tabIndex: -1, visible: false },
  ], "Frozen roving tabindex should cover exactly the remaining items");
  await frozenPage.keyboard.press("ArrowDown");
  assert.equal(await frozenPage.evaluate(() => document.activeElement?.id), "sm-doc");
  await frozenPage.keyboard.press("ArrowDown");
  assert.equal(await frozenPage.evaluate(() => document.activeElement?.id), "sm-trail", "Frozen ArrowDown should wrap across only visible items");
  await frozenPage.keyboard.press("ArrowUp");
  assert.equal(await frozenPage.evaluate(() => document.activeElement?.id), "sm-doc", "Frozen ArrowUp should wrap across only visible items");
  await frozenPage.keyboard.press("Escape");
  assert.equal(await frozenPage.evaluate(() => document.activeElement?.id), "t-share", "Frozen Share Escape should restore its trigger");
  await frozenPage.close();

  const frozenPayloadMatch = frozenHtml.match(/<script type="application\/vnd\.rabbithole\+json" id="rabbithole-portable">([\s\S]*?)<\/script>/);
  assert.equal(extractSnapshotPayload(frozenHtml), frozenPayloadMatch[1], "second real snapshot payload extraction should match the shipped extractor");
  await page.evaluate(() => {
    window.__askRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function() {
      return { left: -24, right: 76, top: innerHeight - 24, bottom: innerHeight - 4, width: 100, height: 20, x: -24, y: innerHeight - 24 };
    };
  });
  await selectText(page, "Euler identity");
  await page.waitForSelector("#ask.visible");
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "ask-text", "opening the selection bar must focus its input for immediate typing");
  const askEdge = await page.evaluate(() => {
    const anchor = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const bar = document.getElementById("ask").getBoundingClientRect();
    const styles = getComputedStyle(document.documentElement);
    return { placement: document.getElementById("ask").dataset.placement, gap: anchor.top - bar.bottom,
      tokenGap: parseFloat(styles.getPropertyValue("--surface-gap")), left: bar.left,
      edge: parseFloat(styles.getPropertyValue("--surface-edge")), right: bar.right, width: innerWidth };
  });
  assert.equal(askEdge.placement, "top-start", "a virtual selection anchor should flip above at the viewport bottom");
  assert(Math.abs(askEdge.gap - askEdge.tokenGap) < 1, `a flipped virtual selection anchor should preserve the token gap, got ${askEdge.gap.toFixed(2)}px vs ${askEdge.tokenGap.toFixed(2)}px`);
  assert(askEdge.left >= askEdge.edge - 1 && askEdge.right <= askEdge.width - askEdge.edge + 1, "the selection bar should clamp inside token viewport edges");
  await page.evaluate(() => { Range.prototype.getBoundingClientRect = window.__askRangeRect; delete window.__askRangeRect; });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#ask:not(.visible)", { state: "attached" });
  await page.waitForFunction(() => document.activeElement?.matches(".node.root"));
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "Euler identity", "selection-bar Escape should preserve the live text selection");
  assert.equal(await page.evaluate(() => document.body.classList.contains("mode-canvas")), true, "selection-bar Escape must stay inside the selection bar");

  await selectText(page, "Euler identity");
  await page.waitForSelector("#ask.visible");
  await page.waitForFunction(() => document.activeElement?.id === "ask-text", null, { timeout: 5000 })
    .catch(() => { throw new Error("the selection bar must focus its input on open"); });
  await page.keyboard.type("Why does this matter?");
  await page.keyboard.press("Control+Enter");
  await page.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
  // No flight wait here: the .pending state is transient and the tile must be
  // caught before the mock provider finishes streaming.
  await page.waitForSelector('.side-item.pending[role="link"]');
  const pendingSidebarContract = await page.locator('.side-item.pending[role="link"]').evaluate((tile) => {
    tile.__s9Identity = "pending-stream-tile";
    return { id: tile.dataset.child, tabIndex: tile.tabIndex, name: tile.getAttribute("aria-label") };
  });
  assert.equal(pendingSidebarContract.tabIndex, 0, "pending margin notes should be tabbable links");
  assert.match(pendingSidebarContract.name, /^Open branch: .+, pending$/, "pending margin notes should name the branch and pending state");
  const pendingAlignment = await page.evaluate((id) => {
    const tile = document.querySelector(`#margin-notes .side-item[data-child="${id}"]`);
    const mark = document.querySelector(`#reader-main mark[data-child="${id}"]`);
    const rail = document.getElementById("reader-rail").getBoundingClientRect();
    const card = tile.getBoundingClientRect();
    return { tileLeft: card.left, tileRight: card.right, railLeft: rail.left, railRight: rail.right, hasMark: !!mark };
  }, pendingSidebarContract.id);
  assert(pendingAlignment.hasMark && pendingAlignment.tileLeft >= pendingAlignment.railLeft && pendingAlignment.tileRight <= pendingAlignment.railRight,
    `anchored branches must retain their inline mark while their card stays in the persistent rail (${JSON.stringify(pendingAlignment)})`);
  const streamedSidebarTile = page.locator(`.side-item[data-child="${pendingSidebarContract.id}"][role="link"]`);
  await page.waitForFunction((id) => !document.querySelector(`.side-item[data-child="${id}"]`)?.classList.contains("pending"), pendingSidebarContract.id);
  assert.equal(await streamedSidebarTile.evaluate((tile) => tile.__s9Identity),
    "pending-stream-tile", "stream updates should patch the pending sidebar tile without replacing it");
  assert.equal(await page.locator('.side-item[role="link"] .si-live').count(), 0, "settling a streamed sidebar branch should remove its one live pane");
  assert.equal(providerCalls, 2);

  const sidebarTile = streamedSidebarTile;
  assert.deepEqual(await sidebarTile.evaluate((tile) => ({ role: tile.getAttribute("role"), tabIndex: tile.tabIndex, name: tile.getAttribute("aria-label") })),
    { role: "link", tabIndex: 0, name: "Open branch: Why does this matter?" }, "settled sidebar tiles should expose named link semantics without activity state");
  await sidebarTile.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('.crumb[aria-current="page"]')?.textContent === "Euler branch");

  const breadcrumbContract = await page.locator("#breadcrumb").evaluate((nav) => {
    const crumbs = [...nav.querySelectorAll(".crumb:not(.crumb-canvas)")];
    crumbs[0].__s9Identity = "root-crumb";
    crumbs[1].__s9Identity = "child-crumb";
    return {
      tag: nav.tagName,
      label: nav.getAttribute("aria-label"),
      prior: { role: crumbs[0].getAttribute("role"), tabIndex: crumbs[0].tabIndex },
      current: { current: crumbs[1].getAttribute("aria-current"), tabIndex: crumbs[1].getAttribute("tabindex") },
    };
  });
  assert.deepEqual(breadcrumbContract, {
    tag: "NAV", label: "Breadcrumb", prior: { role: "link", tabIndex: 0 }, current: { current: "page", tabIndex: null },
  }, "breadcrumbs should expose a landmark, linked ancestors, and a non-focusable current page");
  await page.locator('.crumb[role="link"]:not(.crumb-canvas)').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('.crumb[aria-current="page"]')?.textContent === "Web Smoke");
  assert.equal(await page.locator('.crumb[aria-current="page"]').evaluate((crumb) => crumb.__s9Identity), "root-crumb", "breadcrumb nodes should be reused when their state changes");
  assert.equal(await streamedSidebarTile.evaluate((tile) => tile.__s9Identity),
    "pending-stream-tile", "sidebar nodes should be reused after navigating away and back");
  await streamedSidebarTile.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('.crumb[aria-current="page"]')?.textContent === "Euler branch");
  assert.equal(await page.locator('.crumb[aria-current="page"]').evaluate((crumb) => crumb.__s9Identity), "child-crumb", "breadcrumb child identity should survive lineage removal and restoration");

  const contextStrip = page.locator('.reader-context[role="link"]');
  assert.deepEqual(await contextStrip.evaluate((strip) => ({ tabIndex: strip.tabIndex, name: strip.getAttribute("aria-label") })),
    { tabIndex: 0, name: "See this in its original context" }, "linked reader context should be a named tabbable link");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    window.__s9OriginFlashObserver = new MutationObserver(() => {
      if (document.querySelector('mark[data-child].mark-flash')) window.__s9OriginFlashed = true;
    });
    window.__s9OriginFlashObserver.observe(document.getElementById("reader-main"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await contextStrip.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('.crumb[aria-current="page"]')?.textContent === "Web Smoke");
  await page.waitForFunction(() => window.__s9OriginFlashed === true);
  assert.equal(await page.evaluate(() => { window.__s9OriginFlashObserver.disconnect(); return window.__s9OriginFlashed; }), true,
    "reader-context Enter should jump to and flash the origin");
  await page.evaluate(() => document.getElementById("reader-restore").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  await waitForCanvasText(page, "Euler identity connects rotation");

  const branchMark = page.locator('.node mark[data-child].mark-ready').first();
  assert.deepEqual(await branchMark.evaluate((mark) => ({ tabIndex: mark.tabIndex, role: mark.getAttribute("role"), name: mark.getAttribute("aria-label") })),
    { tabIndex: 0, role: "link", name: "Open branch: Euler branch" }, "branch marks should expose keyboard navigation semantics and the branch title");
  await branchMark.hover();
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#peek").count(), 0, "hovering a mark must not raise any peek surface — marks are plain links");

  await page.focus("#t-theme");
  const visitedTabStops = new Set([await page.evaluate(() => {
    const start = document.querySelector("#t-theme");
    return start?.id || `${start?.tagName}:${[...document.querySelectorAll(start?.tagName || "*")].indexOf(start)}`;
  })]);
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const tabStop = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        isBranchMark: active?.matches('mark[data-child]') || false,
        key: active?.id || `${active?.tagName}:${[...document.querySelectorAll(active?.tagName || "*")].indexOf(active)}`,
      };
    });
    if (tabStop.isBranchMark) break;
    if (visitedTabStops.has(tabStop.key)) break;
    visitedTabStops.add(tabStop.key);
  }
  assert.equal(await page.evaluate(() => document.activeElement?.matches('mark[data-child]')), true, "branch marks should be reachable in the shared document Tab order");
  assert.notEqual(await branchMark.evaluate((mark) => getComputedStyle(mark).outlineStyle), "none", "focused branch marks should show a keyboard ring");

  // Enter (and click) on a canvas mark dives the canvas to the answer card —
  // it stays in canvas mode and flashes the card, never opening a popup.
  // The flash class lives a single frame, so watch for it with an observer.
  const armFlashProbe = () => page.evaluate(() => {
    window.__markDiveFlashed = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector(".node:not(.root).flash")) { window.__markDiveFlashed = true; observer.disconnect(); }
    });
    observer.observe(document.getElementById("world"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await armFlashProbe();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__markDiveFlashed === true);
  assert.equal(await page.evaluate(() => document.body.classList.contains("mode-canvas")), true, "Enter on a canvas mark must stay in canvas and dive to the card");
  await page.waitForTimeout(400);
  await zoomToFit(page); // the dive moved the parent's mark off-screen — refit first
  await page.waitForTimeout(400);
  await armFlashProbe();
  await branchMark.click();
  await page.waitForFunction(() => window.__markDiveFlashed === true);
  assert.equal(await page.evaluate(() => document.body.classList.contains("mode-canvas")), true, "clicking a canvas mark must stay in canvas and dive to the card");

  await page.waitForSelector("body.mode-canvas");
  await zoomToFit(page); // leave the mark-dive zoom behind so removal is measured from a neutral view
  await page.waitForTimeout(400);
  const undoChild = page.locator('.node:not(.root)', { hasText: "Euler identity connects rotation" });
  const undoChildId = await undoChild.getAttribute("data-id");
  await undoChild.locator('.node-btn[aria-label="Collapse card"]').click();
  const branchBeforeUndo = await undoChild.evaluate((card) => ({
    left: card.style.left, top: card.style.top, width: card.style.width,
    collapsed: card.classList.contains("collapsed"), text: card.textContent,
  }));
  const childDelete = undoChild.locator('.node-btn.danger');
  await childDelete.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(`.node[data-id="${undoChildId}"]`, { state: "detached" });
  await page.waitForSelector("#branch-undo.visible");
  assert.equal(await page.locator("#confirm").count(), 0, "the old branch confirmation surface must be removed entirely");
  const undoToastCraft = await page.locator("#branch-undo").evaluate((toast) => {
    const style = getComputedStyle(toast);
    return {
      role: toast.getAttribute("role"), live: toast.getAttribute("aria-live"), message: toast.querySelector("[data-notice-message]").textContent,
      action: toast.querySelector("[data-notice-action]").textContent, shadow: style.boxShadow, radius: style.borderRadius,
    };
  });
  assert.deepEqual({ role: undoToastCraft.role, live: undoToastCraft.live, message: undoToastCraft.message, action: undoToastCraft.action },
    { role: "status", live: "polite", message: "Branch removed", action: "Undo" },
    "the undo toast should be a concise accessible status surface");
  assert.notEqual(undoToastCraft.shadow, "none", "the undo toast should use the shared elevated-surface craft");
  assert(Number.parseFloat(undoToastCraft.radius) > 0, "the undo toast should use the shared rounded-surface craft");
  await page.locator("#branch-undo [data-notice-action]").click();
  await page.waitForSelector(`.node[data-id="${undoChildId}"]`);
  assert.deepEqual(await page.locator(`.node[data-id="${undoChildId}"]`).evaluate((card) => ({
    left: card.style.left, top: card.style.top, width: card.style.width,
    collapsed: card.classList.contains("collapsed"), text: card.textContent,
  })), branchBeforeUndo, "Undo should restore the branch position, collapsed state, and content exactly");
  assert.equal(await page.locator(`path[data-child="${undoChildId}"]`).count(), 1, "Undo should restore the branch edge");
  assert.equal(await page.locator(`mark[data-child="${undoChildId}"]`).count(), 1, "Undo should restore the branch origin mark");
  await page.locator(`.node[data-id="${undoChildId}"] .node-btn[aria-label="Expand card"]`).click();

  // Export while the child is the current node so the frozen reader opens with
  // a parent crumb (mark clicks no longer change the current node).
  await page.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  await page.locator('.side-item[role="link"]').first().click();
  await page.locator("#reader-main", { hasText: "Euler identity connects rotation" }).waitFor();
  await page.evaluate(() => document.getElementById("reader-restore").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  const branchFrozenHtml = await page.evaluate(() => window.__rabbitholeTest.exportSnapshot());
  const branchFrozenPage = await context.newPage();
  await branchFrozenPage.setContent(branchFrozenHtml, { waitUntil: "load" });
  await branchFrozenPage.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
  await branchFrozenPage.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  assert.deepEqual(await branchFrozenPage.locator("#breadcrumb").evaluate((nav) => ({ tag: nav.tagName, label: nav.getAttribute("aria-label") })),
    { tag: "NAV", label: "Breadcrumb" }, "frozen reader should preserve breadcrumb landmark semantics");
  await branchFrozenPage.locator('.crumb[role="link"]:not(.crumb-canvas)').focus();
  await branchFrozenPage.keyboard.press("Enter");
  await branchFrozenPage.waitForFunction(() => document.querySelectorAll("#breadcrumb .crumb:not(.crumb-canvas)").length === 1);
  const frozenSidebar = branchFrozenPage.locator('.side-item[role="link"]').first();
  assert.equal(await frozenSidebar.evaluate((tile) => tile.tabIndex), 0,
    "frozen margin notes should remain keyboard navigable");
  await frozenSidebar.focus();
  await branchFrozenPage.keyboard.press("Enter");
  await branchFrozenPage.waitForFunction(() => document.querySelectorAll("#breadcrumb .crumb:not(.crumb-canvas)").length > 1);
  await branchFrozenPage.locator('.crumb[role="link"]:not(.crumb-canvas)').focus();
  await branchFrozenPage.keyboard.press("Enter");
  await branchFrozenPage.waitForFunction(() => document.querySelectorAll("#breadcrumb .crumb:not(.crumb-canvas)").length === 1);
  await branchFrozenPage.evaluate(() => document.getElementById("reader-restore").click());
  await branchFrozenPage.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  const frozenMark = branchFrozenPage.locator('.node mark[data-child].mark-ready').first();
  await frozenMark.focus();
  await branchFrozenPage.evaluate(() => {
    window.__markDiveFlashed = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector(".node:not(.root).flash")) { window.__markDiveFlashed = true; observer.disconnect(); }
    });
    observer.observe(document.getElementById("world"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await branchFrozenPage.keyboard.press("Enter");
  await branchFrozenPage.waitForFunction(() => window.__markDiveFlashed === true);
  assert.equal(await branchFrozenPage.evaluate(() => document.body.classList.contains("mode-canvas")), true,
    "Enter on a frozen canvas mark should dive to the card in place");
  await branchFrozenPage.close();

  await page.evaluate(() => document.querySelector(".node.current [aria-label=\'Expand document\']").click());
  await page.waitForFunction(() => !document.body.classList.contains("mode-flight"));
  await page.fill("#composer-text", "Go one layer deeper.");
  await page.click('#composer-actions [data-commit="ask"]');
  const followupRailCard = page.locator("#margin-notes .side-item", { hasText: "Go one layer deeper." });
  await followupRailCard.waitFor();
  await followupRailCard.click();
  await page.locator("#reader-main", { hasText: "Second branch explains the geometric view" }).waitFor();
  assert.equal(providerCalls, 3);

  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__rabbitholeTest && !!document.querySelector(".node .doc-content[data-node-id]"));
  const reloadedRaw = await page.evaluate(() => window.__rabbitholeTest.readStoredHole().then((hole) => JSON.stringify(hole)));
  assert(reloadedRaw.includes("Euler identity connects rotation"));
  assert(reloadedRaw.includes("Second branch explains the geometric view"));
  assert(!reloadedRaw.includes(MOCK_KEY), "IndexedDB hole record must not contain provider key");
  assert(!page.url().includes(MOCK_KEY), "URL must not contain provider key");

  await page.waitForSelector("body.mode-canvas");
  const finalBranch = page.locator('.node:not(.root)', { hasText: "Euler identity connects rotation" });
  const finalBranchId = await finalBranch.getAttribute("data-id");
  const subtreeBeforeKeyboardUndo = await readCanvasSubtree(page, finalBranchId);
  assert.equal(subtreeBeforeKeyboardUndo.length, 2, "the deletion fixture should contain a branch and its descendant");
  await finalBranch.locator(".node-btn.danger").click();
  await page.waitForFunction((ids) => ids.every((id) => !document.querySelector(`.node[data-id="${id}"]`)), subtreeBeforeKeyboardUndo.map((node) => node.id));
  await page.waitForSelector("#branch-undo.visible");
  await page.keyboard.press("Control+z");
  await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`.node[data-id="${id}"]`)), subtreeBeforeKeyboardUndo.map((node) => node.id));
  assert.deepEqual(await readCanvasSubtree(page, finalBranchId), subtreeBeforeKeyboardUndo,
    "Cmd+Z should restore every node in the subtree with exact content, positions, sizes, and collapsed state");
  assert.equal(await page.locator("#branch-undo.visible").count(), 0, "Cmd+Z should dismiss the active undo toast");
  for (const node of subtreeBeforeKeyboardUndo) {
    assert.equal(await page.locator(`path[data-child="${node.id}"]`).count(), 1, `Undo should restore the edge for ${node.id}`);
  }

  const descendantId = subtreeBeforeKeyboardUndo.find((node) => node.parent_id === finalBranchId).id;
  await page.locator(`.node[data-id="${descendantId}"] .node-btn.danger`).click();
  await page.waitForSelector("#branch-undo.visible");
  await page.locator(`.node[data-id="${finalBranchId}"] .node-btn.danger`).click();
  await page.waitForSelector(`.node[data-id="${finalBranchId}"]`, { state: "detached" });
  await page.locator("#branch-undo [data-notice-action]").click();
  await page.waitForSelector(`.node[data-id="${finalBranchId}"]`);
  assert.equal(await page.locator(`.node[data-id="${descendantId}"]`).count(), 0,
    "removing a second branch should commit the first removal and offer Undo only for the newest one");

  await page.locator(`.node[data-id="${finalBranchId}"] .node-btn.danger`).click();
  await page.waitForSelector("#branch-undo.visible");
  await page.waitForSelector("#branch-undo:not(.visible)", { state: "attached", timeout: 8000 });
  await page.waitForFunction(async () => (await window.__rabbitholeTest.readStoredHole()).nodes.every((node) => node.parent_id === null));
  assert.equal(await page.locator(".node:not(.root)").count(), 0, "an expired undo toast should leave the subtree deletion final");

  const external = requests.filter((url) => !url.startsWith(baseUrl));
  assert(external.length > 0, "provider and key validation should have been called");
  assert(external.every((url) => url === PROVIDER_URL || url === KEY_URL || url === MODEL_URL || url === LOCAL_MODEL_URL), `unexpected external request(s): ${external.join(", ")}`);
  await context.close();
}

// The composer action row's rest/draft swap, read from computed styles.
async function composerRowState(page, selector) {
  return page.locator(selector).evaluate((row) => ({
    lensesVisible: Array.from(row.querySelectorAll(".lens")).every((button) => getComputedStyle(button).display !== "none"),
    commitsHidden: Array.from(row.querySelectorAll(".ask-commit")).every((button) => getComputedStyle(button).display === "none"),
  }));
}

async function zoomToFit(page) {
  await page.keyboard.press("Control+K");
  await page.fill("#pal-text", "Zoom to fit");
  await page.press("#pal-text", "Enter");
  await page.waitForSelector("#palette", { state: "hidden" });
}

async function readCanvasSubtree(page, rootId) {
  return page.evaluate(async (targetId) => {
    const hole = await window.__rabbitholeTest.readStoredHole();
    const byParent = new Map();
    for (const node of hole.nodes) {
      const siblings = byParent.get(node.parent_id) || [];
      siblings.push(node);
      byParent.set(node.parent_id, siblings);
    }
    const ids = [];
    const visit = (id) => {
      ids.push(id);
      for (const child of byParent.get(id) || []) visit(child.id);
    };
    visit(targetId);
    return ids.map((id) => {
      const node = hole.nodes.find((candidate) => candidate.id === id);
      const card = document.querySelector(`.node[data-id="${id}"]`);
      return {
        id: node.id, parent_id: node.parent_id, title: node.title, markdown: node.markdown,
        origin: node.origin, position: node.position, size: node.size, collapsed: node.collapsed,
        status: node.status, extensions: node.extensions,
        card: { left: card.style.left, top: card.style.top, width: card.style.width, collapsed: card.classList.contains("collapsed") },
      };
    });
  }, rootId);
}

async function findCanvasBackground(page) {
  return page.evaluate(() => {
    const viewport = document.getElementById("viewport");
    for (let y = innerHeight - 70; y >= 90; y -= 70) {
      for (let x = innerWidth - 70; x >= 70; x -= 70) {
        const target = document.elementFromPoint(x, y);
        if (target && viewport.contains(target) && !target.closest(".node")) return { x, y };
      }
    }
    throw new Error("No empty canvas point found");
  });
}

async function createDocument(page, markdown) {
  const previous = await page.evaluate(() => window.__rabbitholeTest?.currentHoleId?.() || "");
  await page.evaluate((value) => window.__rabbitholeTest.createDocument(value), markdown);
  await page.waitForFunction((oldId) => {
    const id = window.__rabbitholeTest?.currentHoleId?.();
    return id && id !== oldId;
  }, previous);
  await page.waitForSelector(".node .doc-content[data-node-id]");
  return page.evaluate(() => window.__rabbitholeTest.currentHoleId());
}

async function ensureRailOpen(page) {
  if (await page.getAttribute("#t-rail", "aria-expanded") !== "true") {
    await page.click("#t-rail");
  }
  await page.waitForSelector("#web-rail.open");
}

async function waitForCanvasText(page, text) {
  await page.locator(".node", { hasText: text }).first().waitFor();
}

async function selectText(page, needle) {
  await page.evaluate((text) => {
    const root = document.querySelector(".node .doc-content[data-node-id]");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(text);
      if (idx === -1) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 160 }));
      return;
    }
    throw new Error(`Text not found: ${text}`);
  }, needle);
}

async function selectAcrossBlocks(page, startNeedle, endNeedle) {
  await page.evaluate(({ startNeedle, endNeedle }) => {
    const root = document.querySelector(".node.root .doc-content[data-node-id]");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let startNode, startOffset, endNode, endOffset, node;
    while ((node = walker.nextNode())) {
      if (!startNode) {
        const index = node.nodeValue.indexOf(startNeedle);
        if (index !== -1) { startNode = node; startOffset = index; }
      }
      const index = node.nodeValue.indexOf(endNeedle);
      if (index !== -1) { endNode = node; endOffset = index + endNeedle.length; }
    }
    if (!startNode || !endNode) throw new Error(`Cross-block range not found: ${startNeedle} → ${endNeedle}`);
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 160, clientY: 180 }));
  }, { startNeedle, endNeedle });
}
