/** @protects Anchored, docked, popover, and standalone note journeys. */
process.env.RABBITHOLE_E2E_GROUP = "notes";
await import("../harness/web-app-canvas-sharing-scenarios.mjs");
