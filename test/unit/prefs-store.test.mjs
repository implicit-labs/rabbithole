/** @protects machine preference store merge and atomicity capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergePreferences, readPreferences } from "../../src/node/mcp/store/prefs-store.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-prefs-store-"));
const previousDir = process.env.RABBITHOLE_DIR;
process.env.RABBITHOLE_DIR = dir;

try {
  assert.deepEqual(await readPreferences(), {}, "a missing preference file reads as an empty v1 store");

  await mergePreferences({
    "rh-theme": "dark",
    "rh-reading-scale": "1.1",
    "rh-future-setting": "future-value",
  });
  await mergePreferences({ "rh-theme": "light", "rh-reading-scale": null });
  assert.deepEqual(await readPreferences(), {
    "rh-theme": "light",
    "rh-future-setting": "future-value",
  }, "merge applies each key, deletes nulls, and preserves unknown values");

  await Promise.all([
    mergePreferences({ "rh-auto-tidy": "on" }),
    mergePreferences({ "rh-auto-tidy-grace": "120" }),
  ]);
  assert.deepEqual(await readPreferences(), {
    "rh-theme": "light",
    "rh-future-setting": "future-value",
    "rh-auto-tidy": "on",
    "rh-auto-tidy-grace": "120",
  }, "overlapping session writes never clobber unrelated keys");

  const file = path.join(dir, "preferences.json");
  await fs.writeFile(file, "{broken", "utf8");
  assert.deepEqual(await readPreferences(), {}, "corruption never blocks a read");
  await mergePreferences({ "rh-theme": "dark" });
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
    version: 1,
    values: { "rh-theme": "dark" },
  }, "the next write recreates a corrupt file in the canonical envelope");

  const observed = [];
  const large = "x".repeat(48 * 1024);
  const writing = mergePreferences({ "rh-large": large });
  while (true) {
    try {
      observed.push(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const state = await Promise.race([writing.then(() => "done"), new Promise((resolve) => setTimeout(() => resolve("wait"), 0))]);
    if (state === "done") break;
  }
  await writing;
  assert(observed.every((entry) => entry?.version === 1 && entry.values && typeof entry.values === "object"),
    "readers observe only complete JSON before or after the atomic rename");
  assert.equal((await fs.readdir(dir)).some((name) => name.endsWith(".tmp")), false, "atomic temp files are cleaned up");
} finally {
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR;
  else process.env.RABBITHOLE_DIR = previousDir;
  await fs.rm(dir, { recursive: true, force: true });
}

console.log("machine preference store ok");
