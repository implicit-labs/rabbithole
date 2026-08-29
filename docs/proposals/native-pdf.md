---
status: shipped
date: 2026-07-11
---

# Native PDF documents

A PDF opens as selectable native pages without requiring a model call. Each PDF document has two representations: deterministic extracted Markdown for model context and portability, and page images plus line geometry for reading and provenance.

Text selections and drawn regions produce durable crop assets. Those crops remain visible on the child and can be sent as immediate-parent image context. Conversion to a clean Markdown document is explicit, streamed, and reversible on interruption.

The same builder and interaction model serve both hosts. Page assets are budgeted for portable round trips, hostile extension data falls back safely, and frozen snapshots retain a readable Markdown representation.
