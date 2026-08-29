---
status: accepted
date: 2026-08-29
---

# Load-bearing constraints

This decision records the boundaries that organize Rabbithole. Later decisions may supersede individual clauses, but this record is not edited in place.

1. Live canvases and frozen snapshots are delivered as self-contained HTML documents with no external runtime dependency.
2. Browser bundles required by installed usage are committed and reproducible.
3. The shared kernel and local host execute directly from the published package without a compilation step.
4. Standard output is reserved for the MCP protocol; diagnostics use standard error.
5. The shared kernel remains independent of Node, the DOM, and either host.
6. Persisted data from a newer schema is refused clearly rather than reconstructed lossily.
7. Historical settings identifiers are migrated at the storage boundary so saved user configuration remains readable.
8. Frozen bundles cannot reach live transport, provider configuration, browser persistence, or snapshot-export machinery.

These constraints favor offline durability, conservative data handling, and one product across two hosts. They are enforced by generated-artifact checks, package journeys, dependency boundaries, schema contracts, and bundle-graph contracts.
