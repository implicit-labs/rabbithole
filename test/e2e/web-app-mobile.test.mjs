/** @protects Mobile canvas navigation, selection, reader layout, and Chromium/WebKit parity. */
process.env.RABBITHOLE_E2E_GROUP = "mobile";
await import("../harness/web-app-canvas-sharing-scenarios.mjs");
