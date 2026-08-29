import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(rootDir, "test");
const tier = process.argv[2] || "all";
const tiers = ["unit", "contracts", "integration", "e2e", "performance", "packaging"];
const checks = {
  icons: [process.execPath, [path.join(rootDir, "scripts/generate-ionicons.mjs"), "--check"]],
  types: [process.execPath, [path.join(rootDir, "scripts/check-types.mjs")]],
  purity: [process.execPath, [path.join(rootDir, "scripts/check-ui-purity.mjs")]],
  design: [process.execPath, [path.join(rootDir, "scripts/check-design.mjs")]],
  "design-doc": [process.execPath, [path.join(rootDir, "scripts/generate-design-doc.mjs"), "--check"]],
  docs: [process.execPath, [path.join(rootDir, "scripts/build-docs.mjs"), "--check"]],
  ui: [path.join(rootDir, "node_modules/.bin/biome"), ["check", "src/ui"]],
  "ui-architecture": [process.execPath, [path.join(rootDir, "scripts/check-ui-architecture.mjs")]],
  "suite-purity": [process.execPath, [path.join(rootDir, "test/harness/suite-purity.mjs")]],
};

const jobs = [];
if (tier === "all") {
  jobs.push(...Object.entries(checks).map(([name, command]) => ({ name: `check:${name}`, command })));
  for (const name of tiers) jobs.push(...await testJobs(name));
} else if (tier === "isolation-live") {
  jobs.push(...["claude-isolation.test.mjs", "codex-isolation.test.mjs"].map((name) => testJob(path.join(testDir, "integration", name))));
} else if (tiers.includes(tier)) {
  if (tier === "unit") jobs.push(
    { name: "check:icons", command: checks.icons },
    { name: "check:design", command: checks.design },
    { name: "check:design-doc", command: checks["design-doc"] },
    { name: "check:docs", command: checks.docs },
    { name: "check:ui", command: checks.ui },
    { name: "check:ui-architecture", command: checks["ui-architecture"] },
    { name: "check:suite-purity", command: checks["suite-purity"] },
  );
  jobs.push(...await testJobs(tier));
} else {
  process.stderr.write(`Unknown test tier ${JSON.stringify(tier)}. Expected all, ${tiers.join(", ")}, or isolation-live.\n`);
  process.exit(2);
}

const failures = [];
for (const job of jobs) {
  process.stdout.write(`\n==> ${job.name}\n`);
  const code = await run(...job.command);
  if (code !== 0) failures.push(job.name);
}

process.stdout.write(`\n${jobs.length - failures.length} passed, ${failures.length} failed, 0 skipped\n`);
if (failures.length) {
  process.stderr.write(`Failures:\n${failures.map((name) => `- ${name}`).join("\n")}\n`);
  process.exit(1);
}

async function testJobs(name) {
  const directory = path.join(testDir, name);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => testJob(path.join(directory, entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function testJob(file) {
  return {
    name: path.relative(rootDir, file),
    command: [process.execPath, ["--test", file]],
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}
