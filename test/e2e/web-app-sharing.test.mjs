/** @protects Card actions, branching, export, sharing, reload, and undo journeys. */
process.env.RABBITHOLE_E2E_GROUP = "sharing";
await import("../harness/web-app-canvas-sharing-scenarios.mjs");
