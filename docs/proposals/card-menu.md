---
status: shipped
date: 2026-08-16
---

# Card menu and note conversion

Each canvas card gains one anchored menu for discoverable card actions: text size, copy, rename, deep collapse, and deletion. The menu reuses existing behavior rather than creating parallel implementations, and mutation controls disappear from frozen views.

The same proposal made human notes convertible into asks. Conversion reuses the existing note text as the question, keeps anchor and attachment provenance, and changes the existing document from human-authored content into a pending answer. Notes with children are protected from conversion because replacing their body would invalidate descendant anchors.
