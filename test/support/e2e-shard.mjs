// Deterministic e2e shard runner for CI.
//
//   node test/support/e2e-shard.mjs <index> <total>
//     Runs this shard's files sequentially, failing fast on the first
//     nonzero exit (the child's code is propagated).
//
//   node test/support/e2e-shard.mjs --needs-deps <index> <total>
//     Prints the space-separated browsers in this shard whose apt OS
//     libraries the runner lacks — the ones whose playwright import
//     destructures firefox or webkit (chromium's are preinstalled).
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

function listTestFiles() {
  return fs
    .readdirSync(E2E_DIR)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(E2E_DIR, name));
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

// True iff the file itself launches firefox or webkit, judged from its
// playwright import destructuring. A bare word match is too loose: e.g.
// style.webkitBackdropFilter would count a chromium-only file.
function importedExtraBrowsers(file) {
  const measured = TIMINGS[path.basename(file)];
  if (measured) return new Set(measured.browsers || []);
  const source = fs.readFileSync(file, "utf8");
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*["']playwright["']/g;
  const browsers = new Set();
  for (const match of source.matchAll(importPattern)) {
    if (/\bfirefox\b/.test(match[1])) browsers.add("firefox");
    if (/\bwebkit\b/.test(match[1])) browsers.add("webkit");
  }
  return browsers;
}

function usage() {
  console.error("usage: node test/support/e2e-shard.mjs [--needs-deps] <index> <total>");
  process.exit(2);
}

const args = process.argv.slice(2);
const needsDepsMode = args[0] === "--needs-deps";
const positional = needsDepsMode ? args.slice(1) : args;
if (positional.length !== 2) usage();
const index = Number(positional[0]);
const total = Number(positional[1]);
if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
  usage();
}

const bin = packIntoBins(listTestFiles(), total)[index];

if (needsDepsMode) {
  const needed = new Set();
  for (const file of bin.files) {
    for (const browser of importedExtraBrowsers(file)) needed.add(browser);
  }
  console.log([...needed].sort().join(" "));
  process.exit(0);
}

console.log(`shard ${index}/${total}: ${bin.files.length} file(s)`);
for (const file of bin.files) console.log(`  ${path.relative(process.cwd(), file)}`);
for (const file of bin.files) {
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
