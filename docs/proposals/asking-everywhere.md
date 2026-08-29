---
status: draft
date: 2026-08-29
---

# Asking everywhere

Five coordinated changes: asks reach inside rendered visuals, canvas notes convert in one gesture, ask presets become editable instructions, the pin glyph joins the product's own geometry, and agent-published documents become answers. A sixth request — auto-managed canvas nodes — is deliberately deferred to its own proposal.

The organizing principle is the one a greenfield design would have started from: **every piece of rendered content has a two-level address — which block, then a block-owned local coordinate.** Prose keeps its whole-document character offsets as the grandfathered dialect (documents are immutable, so those offsets do not rot), PDF rects are retroactively understood as a local dialect, and everything new speaks block-first.

## 1. Block-scoped asks

Selecting text inside a Mermaid diagram or a `show` fence currently goes nowhere: the rendered output lives in a per-visual shadow root, which the document's flattened text-offset address space cannot reach by construction. The fix is one shared mechanism at the visual-mount layer, not per-type patches.

**Anchor.** The ask anchor gains a third kind alongside text offsets and PDF rects:

```
anchor: { block: { block_id, selected_text } }
```

The fenced source is the model's context — it authored that source, and it already travels inside the parent markdown, so the answering prompt only needs to state that the selection lies inside the named block. The kernel's ask contract admits the new shape; the kernel remains free of DOM concerns because capture happens entirely in the interface.

**Capability contract.** Each visual block type registers three capabilities with the mount layer: `wireSelection` (capture inside its shadow root), `packContext` (describe the anchor for the wire), and `paintMark` (render persistent marks). Mermaid and `show` are the first two implementations; future interactive fences (`walk`, `play`) inherit askability by implementing the same contract.

**Capture.** Primary: shadow-aware selection via `Selection.getComposedRanges()`, falling back to Chromium's shadow-root selection API. Fallback for coarse pointers: tapping a text-bearing element (an SVG `<text>` in Mermaid, a leaf element in `show`) uses that element's text as the selection. The existing ask popover anchors to the selection rect through its virtual-anchor path, so presets, keyboard, and streaming come along unchanged.

**Gestures.** Drag-select opens the ask popover; a plain click (the existing sub-5px movement discriminator) keeps opening the lightbox. Inside the lightbox the same capture is wired and text selection is enabled, because fullscreen is where dense diagrams are actually read.

**Marks.** Persistent marks are block-level: a corner chip on the visual showing its branch count, clicking through to the child. Range-level washes inside diagrams are rejected by design — Mermaid re-renders wholesale on theme change and label text is not unique, so any range mark is fragile by construction. The origin quote on the child card records which label was asked about. Chips render in frozen snapshots (read-only, click-to-dive), and no new runtime enters the self-contained bundle.

## 2. One-gesture ask from a canvas note dot

On the canvas, a docked note's popover offers only deletion and placement. It gains a third action, **Ask**, which places the note as a card and converts it into a pending ask as a single gesture with a single rollback boundary: if the branch request fails to post, the note returns to its docked state rather than stranding as a placed card. The conversion inherits the existing gates (never frozen, never with children).

## 3. Ask presets

The four lens buttons stop impersonating the user. Today a lens submits a canned question as if typed; instead, a preset is an **instruction prefix** composed with whatever the human asked:

- A preset is `{ label, instruction }`. Four fixed slots — matching the number keys and the button row — in **two independent sets**: one for selection asks, one for follow-ups. Both sets ship with today's defaults (Explain, ELI5, Explain with an example, Go deeper) and are editable per slot, with per-slot reset.
- Instruction and typed question travel in **separate wire slots**, so they compose: tapping a preset with an empty composer fires immediately (the implicit question is "this selection" or "this document"), and tapping one with typed text styles that question instead of being disabled as it is today.
- The wire keeps the preset key for badges and titles and adds the instruction text, so an answering host never needs access to the asker's local settings.
- Storage is a versioned key in the global preference store; historical lens identifiers are migrated at the storage boundary, per the load-bearing constraint on settings compatibility.
- Settings gain an **Asking** section in the shared settings sheet, registered for both hosts — presets are product behavior, not a web-host extra. The selection popover's action row becomes generated rather than static markup so the two sets can differ.

## 4. Pin glyph

The Ionicons pushpin family contains exactly one design — the round-head lollipop — in three finishes, and its silhouette reads as a map marker at icon size. The pin joins the product-owned geometry already living inside the icon system (the brand mark, the rail toggle, the fold glyphs): a flat-head thumbtack pair drawn on the same 512 grid and 48 stroke. Outline means "pin this"; filled means "pinned — click to unpin." Every surface updates through the single icon registry, and the test asserting distinct silhouettes for the two states is retained.

## 5. Agent-published answers

`send_to_rabbithole` currently hardcodes every agent-published document as a margin note, which is wrong twice: the card presents model-authored content in the human's note styling, and the prompt context later quotes it back as the human's own annotation.

- By default the tool now creates an **answer document**: no note origin, no origin-quote header, answered status, standard document sizing, revealed by the camera like any other answer. It is not editable in place and carries no note affordances — accepted deliberately.
- An explicit `kind: "note"` parameter preserves the margin-note behavior for agents that genuinely want to annotate, and agent-authored notes now carry agent attribution so prompt context stops misattributing them.
- The node-create path admits the answer shape. The schema change is additive: absence of a note origin is already what identifies every existing answer card, so saved holes remain valid, and the constraint that newer-schema data is refused rather than reconstructed is untouched.

## Constraint compliance

Against the load-bearing constraints: snapshots stay self-contained (chips are markup, no new runtime); the kernel stays host- and DOM-free (anchor contracts in the kernel, capture in the interface); schema changes are additive with migration at the storage boundary; frozen bundles gain no live affordances (no ask surfaces; chips are read-only navigation).

## Sequencing

The agent-answer contract (5) lands first — it is kernel-shaped and unblocks nothing else, so it should not wait. Presets (3) and block-scoped asks (1) are the two substantial tracks and are independent of each other; the note-dot gesture (2) and the pin glyph (4) are small and can land any time. Within block-scoped asks: anchor contract, then capture, then gestures, then chips.
