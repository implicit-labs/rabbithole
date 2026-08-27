import { iconSvg } from "../core/html/icons.js";

const INTERACTIVE_SELECTOR = "button, input, textarea, select, [contenteditable]";
const DUPLICATE_REFERENCE_ATTRIBUTES = ["aria-controls", "aria-describedby", "aria-labelledby", "for"];

/**
 * Viewport projections for canonical canvas cards.
 *
 * The graph owns one real card. This module owns a second, read-oriented
 * presentation above the camera so pinning never changes graph layout, edge
 * geometry, or node identity.
 */
export function createPinnedWindows(options) {
  var layer = options.layer;
  var entries = new Map();
  var nextZ = 1;
  var disposed = false;
  var worldObserver = typeof MutationObserver === "function" ? new MutationObserver(removeDetachedEntries) : null;
  if (worldObserver && options.world) worldObserver.observe(options.world, { childList: true });

  function sync(node, pin) {
    if (disposed || !node?.el || !pin) {
      if (node) remove(node.id);
      return;
    }
    var entry = entries.get(node.id);
    if (!entry) entry = createEntry(node);
    entry.node = node;
    entry.pin = pin;
    ensureSourceBadge(entry);
    positionEntry(entry);
    scheduleRender(entry);
  }

  function createEntry(node) {
    var wrapper = document.createElement("section");
    wrapper.className = "pinned-window";
    wrapper.dataset.pinnedNodeId = node.id;
    wrapper.setAttribute("role", "region");
    wrapper.style.zIndex = String(nextZ++);
    layer.appendChild(wrapper);

    var entry = { node, pin: null, wrapper, sourceBadge: null, card: null, renderFrame: 0,
      renderSuspended: false, renderPending: false,
      lastHeight: Math.max(1, node.el.offsetHeight || node.h || 1), observer: null, resizeObserver: null };
    entry.observer = typeof MutationObserver === "function" ? new MutationObserver(function(){ scheduleRender(entry); }) : null;
    // Mirror document/content changes and inline presentation changes. Card
    // state classes such as hover/flash are intentionally excluded: they are
    // transient canvas feedback and replacing a projection for them could tear
    // down a button between pointerdown and click.
    entry.observer?.observe(node.el, { attributes: true, attributeFilter: ["style"], characterData: true, childList: true, subtree: true });
    entry.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(function(){
      var height = node.el?.offsetHeight;
      if (height > 0) entry.lastHeight = height;
      positionEntry(entry);
      scheduleRender(entry);
    }) : null;
    entry.resizeObserver?.observe(node.el);
    wrapper.addEventListener("pointerdown", function(event){
      wrapper.style.zIndex = String(nextZ++);
      var action = event.target.closest?.("[data-pinned-action]");
      if (action) entry.actionPointer = { id: event.pointerId, action: action.dataset.pinnedAction };
    });
    wrapper.addEventListener("pointerup", function(event){
      var pending = entry.actionPointer;
      entry.actionPointer = null;
      if (!pending || pending.id !== event.pointerId) return;
      var action = event.target.closest?.("[data-pinned-action]")?.dataset.pinnedAction;
      if (action !== pending.action) return;
      entry.pointerAction = action;
      runAction(entry, action, "pointer");
    });
    wrapper.addEventListener("pointercancel", function(){ entry.actionPointer = null; });
    wrapper.addEventListener("click", function(event){
      var action = event.target.closest?.("[data-pinned-action]")?.dataset.pinnedAction;
      if (!action || entry.pointerAction === action) { entry.pointerAction = null; return; }
      runAction(entry, action, event.detail === 0 ? "keyboard" : "pointer");
    });
    entries.set(node.id, entry);
    return entry;
  }

  function ensureSourceBadge(entry) {
    var existing = entry.node.el.querySelector(":scope > .node-head > .node-pin-status");
    if (!existing) {
      existing = document.createElement("span");
      existing.className = "node-pin-status";
      existing.title = "Pinned to screen";
      existing.setAttribute("aria-label", "Pinned to screen");
      existing.innerHTML = iconSvg("pin", { size: 13 });
      var title = entry.node.el.querySelector(":scope > .node-head > .node-title");
      title?.before(existing);
    }
    entry.sourceBadge = existing;
    entry.node.el.classList.add("has-pinned-projection");
  }

  function scheduleRender(entry) {
    if (disposed || !entries.has(entry.node.id)) return;
    if (entry.renderSuspended) { entry.renderPending = true; return; }
    if (entry.renderFrame) return;
    entry.renderFrame = requestAnimationFrame(function(){
      entry.renderFrame = 0;
      if (!entry.node.el?.isConnected || !entries.has(entry.node.id)) return remove(entry.node.id);
      renderEntry(entry);
    });
  }

  function renderEntry(entry) {
    var previousBody = entry.card?.querySelector(":scope > .node-body");
    var previousScroll = previousBody?.scrollTop || 0;
    var source = entry.node.el;
    var card = source.cloneNode(true);
    card.classList.remove("node", "current", "flash", "node-enter", "entered", "has-pinned-projection", "note-editing", "note-draft");
    card.classList.add("pinned-window-card");
    card.removeAttribute("data-id");
    card.style.left = "";
    card.style.top = "";
    card.style.transform = "";
    card.style.transformOrigin = "";
    card.style.display = "";

    card.querySelector(":scope > .node-composer")?.remove();
    card.querySelector(":scope > .node-resize")?.remove();
    card.querySelector(":scope > .node-head > .node-acts")?.remove();
    card.querySelectorAll(".note-dots, .code-copy, .rh-img-handle, .rh-pdf-toolbar, .note-edit-actions").forEach(function(el){ el.remove(); });
    card.querySelectorAll("[id]").forEach(function(el){ el.removeAttribute("id"); });
    card.querySelectorAll("[data-id]").forEach(function(el){ el.removeAttribute("data-id"); });
    card.querySelectorAll("[data-node-id]").forEach(function(el){ el.removeAttribute("data-node-id"); });
    card.querySelectorAll(INTERACTIVE_SELECTOR).forEach(makeReadOnly);
    card.querySelectorAll("*").forEach(function(el){
      for (var i = 0; i < DUPLICATE_REFERENCE_ATTRIBUTES.length; i++) el.removeAttribute(DUPLICATE_REFERENCE_ATTRIBUTES[i]);
    });

    var head = card.querySelector(":scope > .node-head");
    var actions = document.createElement("span");
    actions.className = "pinned-window-actions";
    var showOriginal = iconButton("canvas", "Show original on canvas", "show-original");
    preserveActionGesture(entry, showOriginal, function(){ scheduleRender(entry); });
    actions.appendChild(showOriginal);
    if (!options.readOnly) {
      var unpin = iconButton("pin", "Unpin window", "unpin");
      preserveActionGesture(entry, unpin, function(){ scheduleRender(entry); });
      actions.appendChild(unpin);
    }
    head?.appendChild(actions);
    wireDrag(entry, head);

    var sourceTitle = entry.node.title || "Untitled card";
    entry.wrapper.setAttribute("aria-label", "Pinned: " + sourceTitle);
    entry.wrapper.replaceChildren(card);
    entry.card = card;
    var nextBody = card.querySelector(":scope > .node-body");
    if (nextBody) nextBody.scrollTop = previousScroll;
    copyCanvasPixels(source, card);
    positionEntry(entry);
  }

  function positionEntry(entry) {
    if (!entry.pin || !entry.wrapper) return;
    var sourceHeight = entry.node.el?.offsetHeight;
    if (sourceHeight > 0) entry.lastHeight = sourceHeight;
    var scale = entry.pin.scale;
    entry.wrapper.style.left = entry.pin.x + "px";
    entry.wrapper.style.top = entry.pin.y + "px";
    entry.wrapper.style.width = entry.node.w * scale + "px";
    entry.wrapper.style.height = entry.lastHeight * scale + "px";
    if (entry.card) {
      entry.card.style.width = entry.node.w + "px";
      entry.card.style.height = entry.lastHeight + "px";
      entry.card.style.transform = "scale(" + scale + ")";
    }
  }

  function runAction(entry, action, source) {
    if (!entries.has(entry.node.id)) return;
    if (action === "show-original") {
      options.onShowOriginal?.(entry.node, source);
      return;
    }
    if (action !== "unpin" || options.readOnly) return;
    // The viewport responds synchronously; persistence follows through the
    // canvas callback. A later failed/reloaded save can still reconstruct the
    // projection from canonical extension state.
    remove(entry.node.id);
    options.onUnpin?.(entry.node);
  }

  function wireDrag(entry, head) {
    if (!head) return;
    var pointerId = null, startX = 0, startY = 0, originX = 0, originY = 0, moved = false;
    head.addEventListener("pointerdown", function(event){
      if (event.button !== 0 || event.target.closest("button, a")) return;
      event.preventDefault();
      pointerId = event.pointerId;
      startX = event.clientX; startY = event.clientY;
      originX = entry.pin.x; originY = entry.pin.y;
      moved = false;
      entry.wrapper.classList.add("dragging");
      try { head.setPointerCapture(pointerId); } catch (_error) {}
    });
    head.addEventListener("pointermove", function(event){
      if (pointerId !== event.pointerId) return;
      var dx = event.clientX - startX, dy = event.clientY - startY;
      moved = moved || Math.hypot(dx, dy) > 2;
      var visibleGrip = 44;
      var minX = visibleGrip - entry.wrapper.offsetWidth;
      var maxX = Math.max(0, layer.clientWidth - visibleGrip);
      var minY = 0;
      var maxY = Math.max(0, layer.clientHeight - visibleGrip);
      entry.pin.x = Math.max(minX, Math.min(maxX, originX + dx));
      entry.pin.y = Math.max(minY, Math.min(maxY, originY + dy));
      positionEntry(entry);
    });
    function finish(event) {
      if (pointerId !== event.pointerId) return;
      try { head.releasePointerCapture(pointerId); } catch (_error) {}
      pointerId = null;
      entry.wrapper.classList.remove("dragging");
      if (moved) options.onMove?.(entry.node, entry.pin);
    }
    head.addEventListener("pointerup", finish);
    head.addEventListener("pointercancel", finish);
    head.addEventListener("lostpointercapture", function(){
      if (pointerId === null) return;
      pointerId = null;
      entry.wrapper.classList.remove("dragging");
      if (moved) options.onMove?.(entry.node, entry.pin);
    });
  }

  function remove(id) {
    var entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    if (entry.renderFrame) cancelAnimationFrame(entry.renderFrame);
    entry.observer?.disconnect();
    entry.resizeObserver?.disconnect();
    entry.sourceBadge?.remove();
    entry.node.el?.classList.remove("has-pinned-projection");
    entry.wrapper.remove();
  }

  function removeDetachedEntries() {
    entries.forEach(function(entry, id){ if (!entry.node.el?.isConnected) remove(id); });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    worldObserver?.disconnect();
    Array.from(entries.keys()).forEach(remove);
  }

  return { sync, remove, dispose };
}

function iconButton(icon, label, action) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "node-btn";
  button.setAttribute("aria-label", label);
  button.dataset.pinnedAction = action;
  button.title = label;
  button.innerHTML = iconSvg(icon);
  return button;
}

function preserveActionGesture(entry, button, resumeRender) {
  function begin() {
    entry.renderSuspended = true;
    if (entry.renderFrame) {
      cancelAnimationFrame(entry.renderFrame);
      entry.renderFrame = 0;
      entry.renderPending = true;
    }
  }
  function end() {
    setTimeout(function(){
      entry.renderSuspended = false;
      if (!entry.renderPending) return;
      entry.renderPending = false;
      resumeRender();
    }, 0);
  }
  button.addEventListener("pointerdown", function(){
    begin();
    function finish(){
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      end();
    }
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  });
  button.addEventListener("keydown", function(event){
    if (event.key === "Enter" || event.key === " ") begin();
  });
  button.addEventListener("keyup", function(event){
    if (event.key === "Enter" || event.key === " ") end();
  });
  button.addEventListener("blur", end);
}

function makeReadOnly(element) {
  element.removeAttribute("contenteditable");
  element.tabIndex = -1;
  if ("disabled" in element) element.disabled = true;
  element.setAttribute("aria-disabled", "true");
}

function copyCanvasPixels(source, clone) {
  var sourceCanvases = source.querySelectorAll("canvas");
  var cloneCanvases = clone.querySelectorAll("canvas");
  for (var i = 0; i < Math.min(sourceCanvases.length, cloneCanvases.length); i++) {
    var sourceCanvas = sourceCanvases[i], cloneCanvas = cloneCanvases[i];
    cloneCanvas.width = sourceCanvas.width;
    cloneCanvas.height = sourceCanvas.height;
    try { cloneCanvas.getContext("2d")?.drawImage(sourceCanvas, 0, 0); } catch (_error) {}
  }
}
