import { log, error as logError, warn } from "../logger.js";
import { createBridge } from "./server.js";

const BRIDGE_VERSION = "0.4.0";

export { createBridge } from "./server.js";

export async function runBridge({
  port = 41414,
  newToken = false,
  env = process.env,
} = {}) {
  const bridge = await createBridge({
    port,
    newToken,
    env,
    version: BRIDGE_VERSION,
    logger: { warn },
  });
  await bridge.start();
  log(`Rabbithole bridge listening on ${bridge.url}`);
  log(`Open https://rabbithole.ing/#bridge=${bridge.token}`);
  log(`Pairing token: ${bridge.token}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down bridge`);
    try {
      await bridge.close();
      process.exitCode = 0;
    } catch (error) {
      logError(`Bridge shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
  return bridge;
}
