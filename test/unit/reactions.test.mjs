/** @protects reaction note normalization and selection-only action markup. */
import assert from "node:assert/strict";
import { isReactionNote } from "../../src/core/hole/ask.js";
import { makeNode, projectNode } from "../../src/core/hole/node.js";
import { composerActionsMarkup } from "../../src/core/html/markup.js";

const reaction = makeNode({
  id: "reaction",
  parent_id: "root",
  markdown: "👍",
  origin: {
    kind: "note",
    selected_text: "the marked passage",
    anchor: { offset_start: 4, offset_end: 22 },
    branch_type: "selection",
  },
  extensions: {
    note: { docked: true, reaction: true, future_note_key: "drop me" },
  },
});

assert.deepEqual(reaction.view, { docked: true, reaction: true },
  "canonical node normalization preserves the two owned note presentation flags");
assert.deepEqual(projectNode(reaction, "persist").extensions.note, { docked: true, reaction: true },
  "note projection drops unknown note-extension keys while retaining reaction presentation");
assert.equal(isReactionNote(reaction), true);

const typedGlyph = makeNode({
  id: "typed-glyph",
  parent_id: "root",
  markdown: "👍",
  origin: { kind: "note" },
  extensions: { note: { docked: true } },
});
assert.equal(isReactionNote(typedGlyph), false, "glyph text alone never turns an ordinary note into a reaction");

const selectionActions = composerActionsMarkup({ id: "ask-actions" });
assert.match(selectionActions, /<span class="thumb-pair">/);
assert.match(selectionActions, /data-react="up"[^>]*title="Thumbs up"[^>]*>👍 <kbd>↑<\/kbd>/);
assert.match(selectionActions, /data-react="down"[^>]*title="Thumbs down"[^>]*>👎 <kbd>↓<\/kbd>/);
assert.equal(composerActionsMarkup({ id: "composer-actions" }).includes("thumb-pair"), false,
  "the follow-up composer markup remains reaction-free");
assert.equal(composerActionsMarkup({ includeLenses: false }).includes("thumb-pair"), false,
  "card and note composer markup remains reaction-free");

console.log("ok reactions unit: note flags normalize narrowly and thumbs belong only to selection markup");
