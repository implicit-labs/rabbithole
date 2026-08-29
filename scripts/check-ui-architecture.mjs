import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiRoot = path.join(root, "src/ui");
const canvasRoot = path.join(uiRoot, "canvas");
const failures = [];

if (await exists(path.join(uiRoot, "canvas-view.js"))) failures.push("src/ui/canvas-view.js must not return");

for (const file of await filesUnder(uiRoot)) {
  const source = await fs.readFile(file, "utf8");
  const relative = path.relative(root, file);
  report(relative, source, /\bexport\s+var\b/g, "export var is forbidden; hole-store owns UI state");
  report(relative, source, /\bregister[A-Za-z0-9_$]*Hooks\b/g, "hook registries must be explicit composition arguments");
  if (!relative.endsWith("kit/scope.js")) {
    report(relative, source, /\b(?:edit)?cleanups\s*=\s*\[\]/gi, "cleanup arrays must use createCleanupScope");
  }
}

for (const file of await filesUnder(canvasRoot)) {
  const source = await fs.readFile(file, "utf8");
  const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  if (lines > 300) failures.push(`${path.relative(root, file)}: ${lines} lines exceeds the 300-line canvas-module limit`);
}

if (failures.length) {
  process.stderr.write(`UI architecture check failed (${failures.length})\n${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("ok UI architecture: store ownership, explicit composition, scoped cleanup, and bounded canvas modules\n");

function report(file, source, pattern, message) {
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split("\n").length;
    failures.push(`${file}:${line}: ${message}`);
  }
}

async function filesUnder(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(target);
  }
  return output.sort();
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
