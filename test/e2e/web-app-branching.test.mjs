/** @protects Image-backed asks, note-to-ask conversion, and logical selection marks. */
process.env.RABBITHOLE_E2E_GROUP = "branching";
await import("../harness/web-app-canvas-sharing-scenarios.mjs");
