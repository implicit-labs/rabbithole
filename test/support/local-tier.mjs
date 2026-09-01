// Local browser-tier parent: build once, then bound concurrency outside the
// individual test processes. CI already builds before integration, so that
// invocation skips only the redundant build while keeping the same pool.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const [tier, ...args] = process.argv.slice(2);
if (!new Set(["integration", "e2e"]).has(tier)) usage("Expected integration or e2e tier.");
// CI runners are small; parallelism is a local-laptop win.
const defaultJobs = process.env.CI === "true" ? 1 : 2;
const jobs = parseJobs(args, process.env.RABBITHOLE_TEST_JOBS || defaultJobs);
if (tier === "e2e" && jobs > 4) usage("The e2e sweep has four lanes, so --jobs may not exceed 4.");

if (process.env.CI !== "true") {
  process.stdout.write("\n==> build\n");
  const buildCode = await run(process.execPath, ["build.mjs"]);
  if (buildCode !== 0) process.exit(buildCode);
}

if (tier === "integration") {
  process.exit(await run(process.execPath, ["test/run.mjs", "integration", "--jobs", String(jobs)]));
}

const bins = Array.from({ length: 3 }, (_, index) => ({
  name: `e2e shard ${index}/3`,
  command: [process.execPath, ["test/support/e2e-shard.mjs", String(index), "3"]],
}));
bins.push({
  name: "e2e cross-browser",
  command: [process.execPath, ["test/support/e2e-shard.mjs", "--cross-browser"]],
});
const failures = await runPool(bins, jobs);
if (failures.length) {
  process.stderr.write(`E2E shard failures:\n${failures.map((name) => `- ${name}`).join("\n")}\n`);
  process.exit(1);
}

async function runPool(queue, concurrency) {
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const job = queue[next++];
      process.stdout.write(`\n==> ${job.name}\n`);
      if (await run(...job.command) !== 0) failures.push(job.name);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return failures;
}

async function run(command, commandArgs) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-test-store-"));
  try {
    return await new Promise((resolve) => {
      const child = spawn(command, commandArgs, {
        cwd: ROOT,
        env: { ...process.env, RABBITHOLE_DIR: storeDir },
        stdio: "inherit",
      });
      child.once("error", (error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        resolve(1);
      });
      child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
  } finally {
    await fs.rm(storeDir, { recursive: true, force: true });
  }
}

function parseJobs(args, fallback) {
  let value = fallback;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--jobs" || arg.startsWith("--jobs=")) {
      value = arg === "--jobs" ? args[++index] : arg.slice("--jobs=".length);
    } else {
      usage(`Unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) usage("--jobs and RABBITHOLE_TEST_JOBS must be positive integers.");
  return parsed;
}

function usage(message) {
  process.stderr.write(`${message}\nUsage: node test/support/local-tier.mjs <integration|e2e> [--jobs N]\n`);
  process.exit(2);
}
