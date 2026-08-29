---
status: superseded
date: 2026-07-08
---

# Web extraction audit

This audit mapped the original local host, storage format, browser protocol, renderer, PDF ingestion, and interface runtime before the static web host was extracted.

Its central finding was that the interface was already browser-native in behavior; the true barriers were server-authored HTML on the wire, implicit shared scope, filesystem-bound persistence, and a session class mixing domain and transport responsibilities.

The audit's durable recommendations shipped as a shared renderer, canonical Markdown events, explicit store adapters, a common reducer, provider adapters, and a modular browser runtime. Its file and line inventory is intentionally omitted because it described an architecture that no longer exists.
