import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const configs = ["tsconfig.json", "tsconfig.tests.json", "tsconfig.strict.json"];
const results = await Promise.all(configs.map(async (config) => ({
  config,
  ...await run(process.execPath, [tsc, "-p", config, "--noEmit"]),
})));
const failures = results.filter((result) => result.code !== 0);

if (failures.length) {
  for (const failure of failures) {
    process.stderr.write(`\n--- ${failure.config} ---\n${failure.stdout}${failure.stderr}`);
  }
  process.stderr.write(`\ntype check failed: ${failures.map(({ config }) => config).join(", ")}\n`);
  process.exit(1);
}

process.stdout.write("ok types: source and test baselines plus strict core ratchet\n");

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.stack || error.message}\n` }));
    child.once("exit", (code, signal) => resolve({ code: signal ? 1 : (code ?? 1), stdout, stderr }));
  });
}
