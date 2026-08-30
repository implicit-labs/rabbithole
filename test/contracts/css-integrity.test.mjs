/** @protects CSS source and generated-artifact integrity contracts. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectStylesheet } from "../../scripts/check-css-integrity.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checkScript = path.join(rootDir, "scripts/check-css-integrity.mjs");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-css-integrity-"));

try {
  const poisoned = path.join(tempDir, "poisoned.css");
  await fs.writeFile(poisoned, '.card${""}::after { opacity: 0; }\n', "utf8");
  const result = spawnSync(process.execPath, [checkScript, poisoned], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, "the historical template selector must fail the CLI check");
  assert.match(result.stderr, /poisoned\.css:1:6:/, "the diagnostic must name the file and exact column");
  assert.match(result.stderr, /CSS files are real CSS, never templates/, "the diagnostic must explain the repair");

  const selectorErrors = await inspectStylesheet("selector.css", ".card$::after { opacity: 0; }");
  assert.match(selectorErrors.join("\n"), /selector\.css:1:6: invalid CSS: Unexpected token Delim\('\$'\)/);

  const fragmentErrors = await inspectStylesheet("fragment.css", '.card{""}::after { opacity: 0; }');
  assert.match(fragmentErrors.join("\n"), /fragment\.css:1:\d+: invalid CSS:/);

  const braceErrors = await inspectStylesheet("unmatched.css", ".card { opacity: 0;");
  assert.deepEqual(braceErrors, [
    'unmatched.css:1:7: unmatched opening "{"; CSS delimiters must balance exactly',
  ]);

  assert.deepEqual(await inspectStylesheet("valid.css", ".card::after { opacity: 0; }"), []);
  console.log("ok CSS integrity: template fragments, malformed selectors, and recovery-only braces are rejected");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
