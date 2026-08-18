import {
  CANVAS_BASE,
  buildDocContent,
  canvasBuilt,
  childrenOf,
  closed,
  currentNodeId,
  flashHint,
  fontPx,
  frozen,
  goToNode,
  mode,
  nextOrder,
  nodes,
  playLandingCue,
  postBrowserEvent,
  readerMain,
  registerNode,
  shouldReduceMotion,
  uuid,
  view,
  world
} from "./core.js";
import { DEFAULT_CHILD, nodeOrder, placeChild as sharedPlaceChild } from "../core/layout.js";
import { BRANCH_SELECTION, branchTypeOfNode, isDockedNote, truncate } from "../core/model.js";
import {
  autoGrowEl,
  canConvertNote,
  cancelViewAnimation,
  convertNoteToAsk,
  createNodeEl,
  drawEdges,
  effH,
  noteCommitFromEnter,
  noteComposerActions,
  renderVisibility,
  scheduleEdges
} from "./canvas-view.js";
import { renderMarginNotes } from "./reader.js";
import { removeBranch } from "./branch-surfaces.js";
import { mountPdfRectMark, wrapInContainer } from "./text-marks.js";
import { wireComposerActions } from "./composer-state.js";
import { openPopover } from "./primitives/popover.js";
import { createModuleLifecycle } from "./lifecycle.js";
import { refreshNodeHtml } from "./renderer.js";
import { teardownNode } from "./node-teardown.js";

/*
 * DOCKED NOTES — a note written about a card stays on that card.
 *
 * Nothing here is a new kind of thing: a docked note is an ordinary note node
 * whose extensions bag says it has no place on the canvas yet. It renders as
 * the wash on the words it marks plus a graphite dot in the card's own right
 * padding, and it reads and edits inside one anchored dialog. "Place on canvas"
 * clears the flag and hands the same node a position — same id, same lineage,
 * same MCP payload; only its shape on the page ever changed.
 *
 * The grammar is the product's existing one: single click reads, double click
 * edits — on the wash, on the dot, or on the note's own text in the popover.
 */

var DOT_STACK_GAP = 14;   // minimum vertical rhythm between two dots
var DOT_RADIUS = 4;
var WHOLE_CARD_TOP = 2;   // the ring leads the column, level with the first line

var dockedLifecycle = createModuleLifecycle({ defaults: function(){ return {}; } });
// One popover, one open note. Everything the surface needs to answer for
// itself — which note, which card, which state — lives in this record.
var popSession = null;

export function initDockedNotes(){
  disposeDockedNoteResources(false);
  var scope = dockedLifecycle.beginInit();
  try {
    [world, readerMain].forEach(function(surface){
      scope.listen(surface, "click", onSurfaceClick);
      scope.listen(surface, "dblclick", onSurfaceDblClick);
      scope.listen(surface, "keydown", onSurfaceKeydown);
      scope.listen(surface, "mouseover", function(e){ syncPartnerHighlight(e, true); });
      scope.listen(surface, "mouseout", function(e){ syncPartnerHighlight(e, false); });
      // A card's own body carries its dots along as it scrolls, but an inner
      // scroller (a native PDF) moves the marks underneath them. Scroll does
      // not bubble, so the reposition is caught on the way down.
      scope.listen(surface, "scroll", scheduleEdges, true);
    });
    var surface = popEl();
    scope.listen(surface, "click", onPopoverClick);
    scope.listen(surface, "dblclick", onPopoverDblClick);
    scope.addCleanup(function(){ closeNotePopover({ restoreFocus: false, commit: false }); });
    return disposeDockedNotes;
  } catch (error) {
    disposeDockedNotes();
    throw error;
  }
}

export function disposeDockedNotes(){
  disposeDockedNoteResources(true);
}

function disposeDockedNoteResources(resetHooks){
  closeNotePopover({ restoreFocus: false, commit: false });
  dockedLifecycle.dispose(resetHooks);
  popSession = null;
}

function popEl(){ return document.getElementById("notepop"); }

// ---------------------------------------------------------------------------
// THE MODEL SIDE — creating, placing, removing
// ---------------------------------------------------------------------------

/* One optimistic note path serves anchored selection notes and anchor-less
   whole-card notes. The anchor alone decides whether there is a wash to mark;
   the durable origin stays the reducer's canonical {kind:"note"}. */
export function createDockedNote(parent, markdown, options){
  options = options || {};
  markdown = String(markdown || "").trim();
  if (!parent || !markdown || closed || parent.extensions?.pdf?.converting) return null;
  var anchor = options.anchor || null;
  var origin = anchor
    ? { kind: "note", selected_text: options.selectedText || "", anchor: anchor, branch_type: BRANCH_SELECTION }
    : { kind: "note" };
  var node = registerNode({
    id: uuid(), parent_id: parent.id, title: "Note", html: "", md: markdown,
    base_url: null, base_url_source: null, read: true, origin: origin,
    // A docked note has no place yet. It still carries the default card size so
    // that placing it later is a move, not a measurement.
    x: 0, y: 0, w: DEFAULT_CHILD.w, h: DEFAULT_CHILD.h, font_scale: 1, collapsed: false,
    status: "answered", _order: nextOrder(), _startTs: 0, extensions: { note: { docked: true } }
  });
  paintNoteMarks(parent, node, anchor);
  renderDockedNotes(parent);
  scheduleEdges();
  if (mode === "reader" && currentNodeId === parent.id) renderMarginNotes();
  postBrowserEvent({ type: "node_create", id: node.id, parent_id: parent.id,
    markdown: markdown, origin: origin, docked: true })
    .then(function(res){ if (!res || !res.ok) rollbackDockedNote(node); });
  return node;
}

function paintNoteMarks(parent, node, anchor){
  if (!anchor) return;
  var readerDoc = readerMain.querySelector('.doc-content[data-node-id="' + parent.id + '"]');
  var cardDoc = parent.bodyEl ? parent.bodyEl.querySelector(".doc-content") : null;
  if (anchor.pdf){
    if (mode === "reader") mountPdfRectMark(readerDoc, anchor, node.id, "rh-pdf-mark mark-ready mark-note");
    mountPdfRectMark(cardDoc, anchor, node.id, "rh-pdf-mark mark-ready mark-note");
    return;
  }
  if (mode === "reader") wrapInContainer(readerDoc, anchor, node.id, "hl mark-ready mark-note");
  wrapInContainer(cardDoc, anchor, node.id, "hl mark-ready mark-note");
}

function rollbackDockedNote(node){
  if (nodes[node.id] !== node) return;
  var parent = nodes[node.parent_id];
  teardownNode(node.id);
  renderDockedNotes(parent);
  if (canvasBuilt) drawEdges();
  if (mode === "reader" && currentNodeId === node.parent_id) renderMarginNotes();
  flashHint("Couldn't save that note — it was undone.");
}

/* Placement is spatial, never a change of identity: the note keeps its id and
   its words and gains a position, using the same free-spot search a new branch
   uses. Docked siblings are invisible to that search — they have no place to
   collide with. */
function placeNoteChild(parent, branchType){
  return sharedPlaceChild(parent, branchType, {
    childrenOf: placedChildrenOf,
    effH: effH,
    sort: nodeOrder,
    childSize: DEFAULT_CHILD
  });
}

/** Children that actually occupy canvas space. */
export function placedChildrenOf(id){
  return childrenOf(id).filter(function(node){ return !isDockedNote(node); });
}

export function placeDockedNote(node, sourceRect){
  var parent = node && node.parent_id != null ? nodes[node.parent_id] : null;
  if (!parent || frozen || closed || !isDockedNote(node)) return false;
  var pos = placeNoteChild(parent, branchTypeOfNode(node));
  node.x = pos.x; node.y = pos.y;
  node.extensions = Object.assign({}, node.extensions);
  delete node.extensions.note;
  if (canvasBuilt && !node.el) createNodeEl(node, false);
  renderVisibility();
  renderDockedNotes(parent);
  drawEdges();
  if (mode === "reader" && currentNodeId === parent.id) renderMarginNotes();
  postBrowserEvent({ type: "node_extensions_patch", node_id: node.id, namespace: "note", value: {} });
  postBrowserEvent({ type: "node_update", node_id: node.id,
    position: { x: node.x, y: node.y }, size: { w: node.w, h: node.h } });
  flyNoteToCard(sourceRect, node);
  return true;
}

// The one moment a note travels. A ghost of the note leaves the mark it lived
// on and lands on the card it became — same motion vocabulary as the reader's
// flight, and skipped entirely when the canvas isn't the surface being watched.
function flyNoteToCard(sourceRect, node){
  var card = node.el;
  if (!card) return;
  if (mode !== "canvas" || !sourceRect || document.hidden || shouldReduceMotion()){
    playLandingCue(card, "flash");
    return;
  }
  var target = card.getBoundingClientRect();
  var ghost = document.createElement("div");
  ghost.className = "note-flight";
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = truncate(node.md || "", 220);
  ghost.style.left = sourceRect.left + "px";
  ghost.style.top = sourceRect.top + "px";
  ghost.style.width = Math.max(28, sourceRect.width) + "px";
  ghost.style.height = Math.max(18, sourceRect.height) + "px";
  document.body.appendChild(ghost);
  var scope = dockedLifecycle.scope;
  function settle(){
    ghost.remove();
    if (card.isConnected) playLandingCue(card, "flash");
  }
  function launch(){
    if (!ghost.isConnected) return;
    ghost.classList.add("note-flight-landing");
    ghost.style.left = target.left + "px";
    ghost.style.top = target.top + "px";
    ghost.style.width = target.width + "px";
    ghost.style.height = target.height + "px";
    if (scope) scope.timeout(settle, 520); else setTimeout(settle, 520);
  }
  if (scope) scope.raf(launch); else requestAnimationFrame(launch);
}

// ---------------------------------------------------------------------------
// THE MARGIN — dots that live in the card's own right padding
// ---------------------------------------------------------------------------

function noteAnchorOf(node){ return (node.origin && node.origin.anchor) || null; }

/* Whole-card notes lead the column; anchored notes follow in document order. */
function dockedNotesOf(parent){
  return childrenOf(parent.id).filter(isDockedNote).sort(function(a, b){
    var aAnchor = noteAnchorOf(a), bAnchor = noteAnchorOf(b);
    if (!aAnchor !== !bAnchor) return aAnchor ? 1 : -1;
    if (aAnchor && bAnchor) return aAnchor.offset_start - bAnchor.offset_start;
    return nodeOrder(a, b);
  });
}

function dotLabel(node){
  var words = String(node.md || "").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  return noteAnchorOf(node) ? "Note: " + (words || "empty") : "Note on this card";
}

function canvasDotHost(parent){
  return parent.el && !parent.collapsed ? parent.bodyEl : null;
}
function readerDotHost(parent){
  return mode === "reader" && currentNodeId === parent.id ? readerMain.querySelector(".reader-col") : null;
}

/* Rebuild both dot columns for one card. Cheap enough to call from every place
   that rebuilds the card's body; positioning is a separate, measure-only pass
   because the card's width is only final after layout. */
export function renderDockedNotes(parent){
  if (!parent) return;
  var notes = dockedNotesOf(parent);
  syncDotColumn(canvasDotHost(parent), notes, false);
  syncDotColumn(readerDotHost(parent), notes, true);
  positionDockedNotes();
  if (dockedLifecycle.scope) dockedLifecycle.scope.raf(positionDockedNotes);
}

function syncDotColumn(host, notes, reader){
  if (!host) return;
  var layer = host.querySelector(":scope > .note-dots");
  if (!notes.length){
    if (layer) layer.remove();
    return;
  }
  if (!layer){
    layer = document.createElement("div");
    layer.className = "note-dots";
    host.appendChild(layer);
  }
  layer.classList.toggle("note-dots-reader", !!reader);
  var fragment = document.createDocumentFragment();
  notes.forEach(function(note){
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "note-dot" + (noteAnchorOf(note) ? "" : " note-dot-whole");
    dot.dataset.note = note.id;
    dot.setAttribute("aria-haspopup", "dialog");
    dot.setAttribute("aria-expanded", "false");
    dot.setAttribute("aria-label", dotLabel(note));
    fragment.appendChild(dot);
  });
  layer.replaceChildren(fragment);
}

/* Each dot sits on its anchor's line box, nudging off the exact line only when
   a neighbour is already there. Canvas rects arrive scaled by the camera; the
   column's own coordinates never are. */
export function positionDockedNotes(){
  var layers = document.querySelectorAll(".note-dots");
  for (var i = 0; i < layers.length; i++) positionDotColumn(layers[i]);
}

function positionDotColumn(layer){
  var host = layer.parentElement;
  var reader = layer.classList.contains("note-dots-reader");
  // The reader keeps its DOM while the canvas is up, but its margin column
  // belongs to the document being read: it retires with the mode.
  if (!host || (reader && mode !== "reader")){ layer.remove(); return; }
  var scale = reader ? 1 : (view.scale || 1);
  var hostRect = host.getBoundingClientRect();
  var scrollTop = reader ? 0 : host.scrollTop;
  // The reader's margin is only a margin while there is room for it; a column
  // that fills the window (a native PDF) keeps its dots inside its own edge.
  if (reader) layer.classList.toggle("note-dots-inside", hostRect.right + 26 > (window.innerWidth || 0));
  var previous = -Infinity;
  var dots = layer.children;
  for (var i = 0; i < dots.length; i++){
    var dot = dots[i];
    var mark = markElement(host, dot.dataset.note);
    var markRect = mark ? mark.getBoundingClientRect() : null;
    var top = markRect && markRect.height
      ? (markRect.top - hostRect.top) / scale + scrollTop + (markRect.height / scale) / 2 - DOT_RADIUS
      : WHOLE_CARD_TOP;
    if (top < previous + DOT_STACK_GAP) top = previous + DOT_STACK_GAP;
    previous = top;
    dot.style.top = top + "px";
  }
}

function markElement(scope, noteId){
  if (!scope || !noteId) return null;
  return scope.querySelector('mark[data-child="' + noteId + '"], [data-child="' + noteId + '"].rh-pdf-mark');
}

function visibleElement(selector){
  var found = document.querySelectorAll(selector);
  for (var i = 0; i < found.length; i++){
    if (found[i].isConnected && found[i].getClientRects().length) return found[i];
  }
  return found[0] || null;
}

function affordanceFor(node){
  return visibleElement('.note-dot[data-note="' + node.id + '"]')
    || visibleElement('mark[data-child="' + node.id + '"], [data-child="' + node.id + '"].rh-pdf-mark');
}

// Hovering either half of a note lights the other: the wash and its dot are one
// object seen twice.
function syncPartnerHighlight(event, on){
  var target = event.target;
  if (!target || !target.closest) return;
  var dot = target.closest(".note-dot");
  if (dot){
    if (!on && dot.contains(event.relatedTarget)) return;
    setMarkHighlight(dot.dataset.note, on);
    return;
  }
  var mark = target.closest("[data-child]");
  if (!mark || !isDockedNote(nodes[mark.dataset.child])) return;
  if (!on && mark.contains(event.relatedTarget)) return;
  var partner = visibleElement('.note-dot[data-note="' + mark.dataset.child + '"]');
  if (partner) partner.classList.toggle("note-dot-partner", on);
}

function setMarkHighlight(noteId, on){
  var marks = document.querySelectorAll('[data-child="' + noteId + '"]');
  for (var i = 0; i < marks.length; i++) marks[i].classList.toggle("mark-focus", on);
}

// ---------------------------------------------------------------------------
// GESTURES — click reads, double click edits, wherever the note shows itself
// ---------------------------------------------------------------------------

function dockedNoteFromEvent(event){
  var target = event.target;
  if (!target || !target.closest) return null;
  var dot = target.closest(".note-dot");
  if (dot) return { node: nodes[dot.dataset.note], trigger: dot, placement: "bottom-end" };
  var mark = target.closest("[data-child]");
  if (!mark) return null;
  var node = nodes[mark.dataset.child];
  return isDockedNote(node) ? { node: node, trigger: mark, placement: "bottom-start" } : null;
}

function onSurfaceClick(event){
  var hit = dockedNoteFromEvent(event);
  if (!hit || !hit.node) return;
  if (!window.getSelection().isCollapsed) return; // the human was selecting, not clicking
  event.preventDefault();
  event.stopPropagation();
  openDockedNote(hit.node, hit.trigger, "read", hit.placement);
}

function onSurfaceDblClick(event){
  var hit = dockedNoteFromEvent(event);
  if (!hit || !hit.node) return;
  event.preventDefault();
  event.stopPropagation();
  openDockedNote(hit.node, hit.trigger, editingAllowed() ? "edit" : "read", hit.placement);
}

function onSurfaceKeydown(event){
  if (event.key !== "Enter" && event.key !== "F2") return;
  var hit = dockedNoteFromEvent(event);
  if (!hit || !hit.node) return;
  event.preventDefault();
  event.stopPropagation();
  var wantsEdit = event.key === "F2" || (popSession && popSession.node === hit.node);
  openDockedNote(hit.node, hit.trigger, wantsEdit && editingAllowed() ? "edit" : "read", hit.placement);
}

function editingAllowed(){ return !frozen && !closed; }

// ---------------------------------------------------------------------------
// THE POPOVER — read state, edit state, one anchored dialog
// ---------------------------------------------------------------------------

/** Open a note the human already has on screen (dot, wash, or ⌘K result). */
export function openDockedNote(node, trigger, state, placement){
  if (!node) return;
  openNotePopover({
    node: node,
    parentId: node.parent_id,
    trigger: trigger || affordanceFor(node) || document.getElementById("notepop"),
    state: state === "edit" && editingAllowed() ? "edit" : "read",
    placement: placement
  });
}

/** The card ⋯ menu's "Add note": no selection exists, so the popover is the input. */
export function addDockedNote(parent, trigger){
  if (!parent || !editingAllowed()) return;
  openNotePopover({ node: null, parentId: parent.id, trigger: trigger, state: "edit", placement: "bottom-end" });
}

/* A ⌘K hit on a docked note: it has no card of its own, so travel to the card
   it lives on and open it there. */
export function revealDockedNote(node, source){
  if (!isDockedNote(node)) return false;
  var parent = nodes[node.parent_id];
  if (!parent) return false;
  function show(){
    var affordance = affordanceFor(node);
    if (affordance) openDockedNote(node, affordance, "read");
  }
  if (affordanceFor(node)){ show(); return true; }
  goToNode(parent, source);
  if (dockedLifecycle.scope) dockedLifecycle.scope.raf(show); else show();
  return true;
}

export function closeDockedNotePopover(settings){
  closeNotePopover(settings || { restoreFocus: false, commit: true });
}

function openNotePopover(options){
  var surface = popEl();
  if (!surface || !options.trigger) return;
  closeNotePopover({ restoreFocus: false, commit: true });
  // The dialog is pinned to a card's screen rect and applyTransform dismisses
  // anything anchored there, so an in-flight glide would close it on its very
  // next frame. Reaching for a note yields the glide, exactly as the ⋯ menu does.
  cancelViewAnimation();
  popSession = { node: options.node || null, parentId: options.parentId, trigger: options.trigger,
    state: "read", editor: null, popover: null };
  // Visible before its contents: a textarea inside a hidden surface cannot take
  // focus, and the editor claims the caret in the same frame it appears.
  surface.classList.add("visible");
  renderPopoverState(options.state === "edit" ? "edit" : "read");
  popSession.popover = openPopover({
    trigger: options.trigger,
    surface: surface,
    placement: options.placement || "bottom-end",
    // Escape walks one level at a time here (edit → read → closed), so the
    // layer stack must not swallow the whole dialog on the first press.
    closeOnEscape: false,
    onEscape: onPopoverEscape,
    initialFocus: popSession.editor || surface.querySelector(".note-pop-view"),
    onClose: function(){ closeNotePopover({ commit: true }); }
  });
}

function closeNotePopover(settings){
  var session = popSession;
  if (!session) return;
  popSession = null;
  settings = settings || {};
  if (settings.commit !== false && session.state === "edit") commitEditor(session, "close");
  var surface = popEl();
  if (surface){
    surface.classList.remove("visible", "note-pop-editing");
    surface.querySelector(".note-pop-body").replaceChildren();
  }
  if (session.popover) session.popover.close(settings);
}

function renderPopoverState(state){
  var session = popSession, surface = popEl();
  if (!session || !surface) return;
  session.state = state;
  session.editor = null;
  surface.classList.toggle("note-pop-editing", state === "edit");
  var body = surface.querySelector(".note-pop-body");
  if (state === "edit"){
    body.replaceChildren(buildNoteEditor(session));
    // Sized and focused only once it is in the document: height needs layout
    // and focus needs a visible box.
    autoGrowEl(session.editor, 190);
    session.editor.focus({ preventScroll: true });
    session.editor.setSelectionRange(session.editor.value.length, session.editor.value.length);
    return;
  }
  var view = document.createElement("div");
  view.className = "note-pop-view";
  view.title = editingAllowed() ? "Double-click to edit" : "";
  view.tabIndex = 0;
  view.appendChild(buildDocContent(session.node, CANVAS_BASE));
  body.replaceChildren(view);
  var placeable = editingAllowed() && isDockedNote(session.node);
  surface.querySelector(".note-pop-place").style.display = placeable ? "" : "none";
  surface.querySelector(".note-pop-delete").style.display = editingAllowed() ? "" : "none";
}

/* The edit state is the composer's own bar — the same Note / Ask pair, the same
   keys — because a note being written for the first time and a note being
   rewritten are the same act. */
function buildNoteEditor(session){
  var wrap = document.createElement("div");
  wrap.className = "note-pop-edit has-draft";
  var input = document.createElement("div");
  input.className = "ask-input";
  var editor = document.createElement("textarea");
  editor.className = "note-editor md";
  editor.rows = 1;
  editor.spellcheck = true;
  editor.setAttribute("aria-label", session.node ? "Edit note" : "Write a note");
  editor.value = session.node ? (session.node.md || "") : "";
  // The editor is the prose it replaces, including whatever the reading-size
  // preference and the note's own scale make that prose.
  editor.style.fontSize = fontPx(CANVAS_BASE, session.node ? session.node.font_scale : 1) + "px";
  var actions = noteComposerActions();
  // A note that cannot become an ask keeps the bar with Note alone — one
  // button, so no divider down the middle.
  if (!canAskFromNote(session)){
    actions.querySelector('[data-commit="ask"]').remove();
    actions.classList.add("note-only");
  }
  input.appendChild(editor);
  wrap.append(input, actions);
  session.editor = editor;
  function syncCommits(){
    var disabled = !editor.value.trim();
    var commits = actions.querySelectorAll(".ask-commit");
    for (var i = 0; i < commits.length; i++) commits[i].disabled = disabled;
  }
  editor.addEventListener("input", function(){ autoGrowEl(editor, 190); syncCommits(); });
  wireComposerActions({ text: editor, actions: actions,
    hasDraft: function(){ return !!editor.value.trim(); },
    // The note editor's Enter contract everywhere: Enter is a newline, ⌘↵ asks,
    // ⌘S saves (wired centrally by wireComposerActions).
    commitFromEnter: noteCommitFromEnter,
    onCommit: function(kind, e){ e.stopPropagation(); commitEditor(popSession, kind); },
    onLens: function(){} });
  syncCommits();
  return wrap;
}

/* Asking from a docked note is one motion: the note gains a place and then
   becomes the question, so the answer has something to hang from. */
function canAskFromNote(session){
  if (!editingAllowed()) return false;
  return session.node ? canConvertNote(session.node) : true;
}

function commitEditor(session, kind){
  if (!session || session.state !== "edit" || !session.editor) return;
  var text = session.editor.value.trim();
  var node = session.node;
  if (!text){
    // An empty note is no note: a brand-new one is discarded, an existing one
    // keeps the words it already had.
    if (!node) closeNotePopover({ commit: false });
    else if (kind !== "close") renderPopoverState("read");
    return;
  }
  if (!node){
    node = createDockedNote(nodes[session.parentId], text);
    if (!node) return;
    session.node = node;
  } else if (text !== (node.md || "")){
    node.md = text;
    refreshNodeHtml(node);
    persistNoteText(node);
    renderDockedNotes(nodes[node.parent_id]);
  }
  if (kind === "ask" && placeDockedNote(node, affordanceRect(node)) && convertNoteToAsk(node, text)){
    closeNotePopover({ commit: false });
    return;
  }
  if (kind === "close"){
    session.state = "read";
    return;
  }
  // Saving returns to the read state — you see what you wrote — anchored on the
  // affordance the note now has (a brand-new note has just grown its dot).
  var trigger = affordanceFor(node) || session.trigger;
  closeNotePopover({ restoreFocus: false, commit: false });
  openDockedNote(node, trigger, "read");
}

function persistNoteText(node){
  postBrowserEvent({ type: "node_update", node_id: node.id, title: node.title, markdown: node.md });
}

function focusPopover(){
  var view = popEl().querySelector(".note-pop-view");
  if (view) try { view.focus({ preventScroll: true }); } catch(_e){}
}

function affordanceRect(node){
  var affordance = affordanceFor(node);
  return affordance ? affordance.getBoundingClientRect() : null;
}

function onPopoverClick(event){
  var session = popSession;
  var button = event.target.closest ? event.target.closest("button") : null;
  if (!session || !button) return;
  if (button.classList.contains("note-pop-place")){
    event.stopPropagation();
    var node = session.node, rect = affordanceRect(node);
    closeNotePopover({ restoreFocus: false, commit: false });
    placeDockedNote(node, rect);
  } else if (button.classList.contains("note-pop-delete")){
    event.stopPropagation();
    var doomed = session.node;
    closeNotePopover({ restoreFocus: false, commit: false });
    removeBranch(doomed);
    renderDockedNotes(nodes[doomed.parent_id]);
  }
}

function onPopoverDblClick(event){
  if (!popSession || popSession.state === "edit" || !editingAllowed()) return;
  if (!event.target.closest || !event.target.closest(".note-pop-view")) return;
  event.preventDefault();
  event.stopPropagation();
  renderPopoverState("edit");
}

/* Escape gives back one level at a time: an edit reverts to the note as saved,
   the read state closes the dialog. A brand-new note has no saved state to
   revert to, so its first Escape discards it whole. */
function onPopoverEscape(){
  if (!popSession) return;
  if (popSession.state === "edit" && popSession.node){
    renderPopoverState("read");
    focusPopover();
    return;
  }
  closeNotePopover({ commit: false });
}
