---
status: shipped
date: 2026-07-30
---

# Subscription bridge

The optional bridge lets the web app use an installed, signed-in Claude Code or Codex CLI through a loopback OpenAI-compatible surface.

The security model uses a persistent bearer token, strict host and origin gates, loopback binding, isolated execution, and observed tool-capability tests. State arrives through one authenticated stream, while a minimal unauthenticated ping supports pairing guidance without exposing account state.

Backend-specific discovery and process protocols remain behind one agent contract. Pairing is a link-first flow, reconnects after process restarts, and never puts the token in a request URL.
