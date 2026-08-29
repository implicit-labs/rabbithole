/** @protects ui bundle boundaries capability contracts. */
import assert from "node:assert/strict";
import * as esbuild from "esbuild";
import { CANVAS_SHELL } from "../../src/core/html/shell.js";
import { CANVAS_STYLES } from "../support/design-css.mjs";

const result = await esbuild.build({
  entryPoints: ["src/ui/frozen-entry.js"],
  bundle: true,
  write: false,
  metafile: true,
  format: "iife",
  platform: "browser",
  target: "es2018",
  external: ["pdfjs-dist/build/pdf.mjs"],
  loader: { ".css": "text" },
  logLevel: "silent",
});

const inputs = Object.keys(result.metafile.inputs);
const forbidden = inputs.filter((input) =>
  input.startsWith("src/ui/hosts/live/")
  || input.startsWith("src/web/")
);

assert.deepEqual(
  forbidden,
  [],
  `frozen UI must not reach anything under hosts/live:\n${forbidden.join("\n")}`,
);

const frozenBundle = result.outputFiles[0].text;
const removedActivityUi = `${CANVAS_SHELL}\n${CANVAS_STYLES}\n${frozenBundle}`;
for (const pattern of [
  /id=["']since["']/,
  /while you were away/i,
  /si-new/,
  /pal-dot/,
  /node\.unread/,
  /isUnread/,
  /markRead/,
  /unreadNodes/,
]) {
  assert.doesNotMatch(removedActivityUi, pattern, `removed activity UI must stay absent: ${pattern}`);
}

// The world layer must never be permanently promoted: the compositor then
// bitmap-scales stale text rasters on zoom instead of repainting, so existing
// cards blur while freshly painted ones stay sharp.
const worldRule = CANVAS_STYLES.match(/#world\s*\{[^}]*\}/)?.[0] ?? "";
assert.ok(worldRule, "expected a #world rule in canvas styles");
assert.doesNotMatch(worldRule, /will-change/, "#world must not carry will-change (stale-raster blur on zoom)");

console.log("ok UI bundle boundaries: frozen client excludes live host modules and removed activity messaging");
