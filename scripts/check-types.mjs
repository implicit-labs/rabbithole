import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const configs = ["tsconfig.json", "tsconfig.tests.json", "tsconfig.strict.json"];
const failures = [];

for (const config of configs) {
  const code = await run(process.execPath, [tsc, "-p", config, "--noEmit"]);
  if (code !== 0) failures.push(config);
}

if (failures.length) {
  process.stderr.write(`type check failed: ${failures.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write("ok types: source and test baselines plus strict core ratchet\n");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}
