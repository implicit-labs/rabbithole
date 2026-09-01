// Deterministic e2e shard runner for CI.
//
//   node test/support/e2e-shard.mjs <index> <total>
//     Runs this Chromium-only shard's files sequentially, failing fast on the
//     first nonzero exit (the child's code is propagated).
//
//   node test/support/e2e-shard.mjs --cross-browser
//     Runs every file whose timings metadata declares extra browsers.
//
//   node test/support/e2e-shard.mjs --needs-deps <index> <total>
//   node test/support/e2e-shard.mjs --needs-deps --cross-browser
//     Prints the space-separated browsers in this lane whose apt OS libraries
//     the runner lacks (chromium's are preinstalled).
//     Prints nothing for a chromium-only shard.
//
// Packing is greedy by descending measured runtime (stable name tiebreak):
// each file lands in the currently lightest bin, so the assignment depends
// only on the checked-in file set — every matrix job computes the same bins.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "e2e");
const TIMINGS = JSON.parse(fs.readFileSync(path.join(E2E_DIR, "..", "timings.json"), "utf8"));

function listTestFiles({ crossBrowser }) {
  const files = fs
    .readdirSync(E2E_DIR)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(E2E_DIR, name));
  return files.filter((file) => (declaredExtraBrowsers(file).size > 0) === crossBrowser);
}

function packIntoBins(files, total) {
  const bySizeDescending = files
    .map((file) => {
      const timing = TIMINGS[path.basename(file)];
      if (!timing || !Number.isFinite(timing.ms)) throw new Error(`Missing measured timing for ${path.basename(file)}`);
      return { file, size: timing.ms };
    })
    .sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : 1));
  const bins = Array.from({ length: total }, () => ({ files: [], size: 0 }));
  for (const entry of bySizeDescending) {
    let lightest = bins[0];
    for (const bin of bins) {
      if (bin.size < lightest.size) lightest = bin;
    }
    lightest.files.push(entry.file);
    lightest.size += entry.size;
  }
  return bins;
}

function declaredExtraBrowsers(file) {
  const measured = TIMINGS[path.basename(file)];
  if (!measured || !Array.isArray(measured.browsers)) {
    throw new Error(`Missing browser metadata for ${path.basename(file)}`);
  }
  return new Set(measured.browsers);
}

function usage() {
  console.error("usage: node test/support/e2e-shard.mjs [--needs-deps] <index> <total>");
  console.error("       node test/support/e2e-shard.mjs [--needs-deps] --cross-browser");
  process.exit(2);
}

const args = process.argv.slice(2);
const needsDepsMode = args.includes("--needs-deps");
const crossBrowserMode = args.includes("--cross-browser");
const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--needs-deps" && arg !== "--cross-browser");
const positional = args.filter((arg) => !arg.startsWith("--"));
if (unknownFlags.length || (crossBrowserMode ? positional.length !== 0 : positional.length !== 2)) usage();

let label;
let files;
if (crossBrowserMode) {
  label = "cross-browser";
  files = listTestFiles({ crossBrowser: true });
} else {
  const index = Number(positional[0]);
  const total = Number(positional[1]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) usage();
  label = `shard ${index}/${total}`;
  files = packIntoBins(listTestFiles({ crossBrowser: false }), total)[index].files;
}

if (needsDepsMode) {
  const needed = new Set();
  for (const file of files) {
    for (const browser of declaredExtraBrowsers(file)) needed.add(browser);
  }
  console.log([...needed].sort().join(" "));
  process.exit(0);
}

console.log(`${label}: ${files.length} file(s)`);
for (const file of files) console.log(`  ${path.relative(process.cwd(), file)}`);
for (const file of files) {
  console.log(`\n--- ${path.relative(process.cwd(), file)}`);
  // Throwaway store dir: e2e tests boot real server modules, which otherwise
  // default to ~/.rabbithole and write into the operator's live data.
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-test-store-"));
  let result;
  try {
    result = spawnSync(process.execPath, [file], {
      stdio: "inherit",
      env: { ...process.env, RABBITHOLE_DIR: storeDir },
    });
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}
