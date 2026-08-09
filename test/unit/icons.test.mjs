import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { BUNNY_MARK_SVG, faviconSvg, iconSvg } from "../../src/core/html/icons.js";
import { ICON_SELECTIONS } from "../../src/core/html/icon-selection.js";

const send = iconSvg("send");
assert.match(send, /^<svg width="14" height="14" /);
assert.match(send, /focusable="false" aria-hidden="true"/);
assert.match(iconSvg("search", { size: 13 }), /^<svg width="13" height="13" /);
assert.match(iconSvg("search"), /viewBox="0 0 512 512" fill="currentColor" stroke="currentColor"/);
assert.match(iconSvg("search"), /stroke-width="48"/);
assert.doesNotMatch(iconSvg("search"), /(?:class|xmlns|<title)=?/);
assert.notEqual(iconSvg("paste"), iconSvg("file"), "paste and file actions need distinct silhouettes");
assert.notEqual(iconSvg("frame"), iconSvg("area-select"), "frame and area selection need distinct silhouettes");
assert.equal(BUNNY_MARK_SVG, iconSvg("bunny"));
assert.match(faviconSvg(), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
assert.throws(() => iconSvg("missing"), /Unknown Rabbithole icon/);
assert.throws(() => iconSvg("send", { size: 0 }), /positive number/);
assert.equal(Object.keys(ICON_SELECTIONS).length, 31, "every functional icon role belongs in the shared selection map");
for (const name of Object.keys(ICON_SELECTIONS)) assert.match(iconSvg(name), /^<svg/);

const roots = ["src", "website/about"];
const inspectedFiles = [];
const violations = [];
for (const root of roots) {
  for (const file of await sourceFiles(root)) {
    inspectedFiles.push(file);
    if (file === "src/core/html/icons.js") continue;
    let source = await fs.readFile(file, "utf8");
    if (file === "src/core/html/shell.js") {
      source = source.replace('<svg id="edges"></svg>', "");
    }
    if (source.includes("<svg")) violations.push(file);
  }
}
assert(inspectedFiles.includes("src/core/html/icons.js"), "icon source scan must inspect the canonical icon file");
assert.deepEqual(
  violations,
  [],
  `product-owned SVG geometry belongs in src/core/html/icons.js:\n${violations.join("\n")}`,
);

console.log("ok icons: canonical markup, validation, and repository boundary");

async function sourceFiles(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const relative = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(relative));
    else if (/\.(?:js|mjs|html)$/.test(entry.name)) files.push(relative);
  }
  return files;
}
