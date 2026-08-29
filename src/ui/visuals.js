// ===========================================================================
// VISUAL FENCES
// ===========================================================================
import { getBlockType } from "../core/blocks.js";
import { iconSvg } from "../core/html/icons.js";
import { BUTTON_OPEN } from "../core/html/markup.js";
import { escapeHtml } from "../core/utils.js";
import { disposeLightbox, openLightbox } from "./lightbox.js";
import { visualStylesFor } from "./visual-style-runtime.js";

let visualSurfaceCaches = {};
const blockMounts = {};
let mermaidRuntimePromise = null;
let mermaidRenderQueue = Promise.resolve();
let mermaidRenderId = 0;
let mermaidControllers = [];
let mermaidThemeObserver = null;
let mermaidGeneration = 0;
const utf8Decoder = typeof TextDecoder === "function" ? new TextDecoder("utf-8") : null;

function loadEmbeddedMermaidRuntime() {
  if (window.mermaid) return window.mermaid;
  const carrier = document.getElementById("rabbithole-mermaid-runtime");
  if (!carrier || !carrier.textContent) throw new Error("Mermaid runtime is unavailable");
  const script = document.createElement("script");
  script.setAttribute("data-rabbithole-runtime", "mermaid");
  script.textContent = carrier.textContent;
  (document.head || document.body || document.documentElement).appendChild(script);
  script.remove();
  if (!window.mermaid) throw new Error("Mermaid runtime failed to initialize");
  return window.mermaid;
}

function defaultVisualHooks() {
  return {
    post: function () {
      return Promise.resolve({ ok: true });
    },
    getNode: function () {
      return null;
    },
    loadMermaid: loadEmbeddedMermaidRuntime,
  };
}
/** @type {any} */
let visualHooks = defaultVisualHooks();
let visualHooksReady = false;
const VISUAL_ALLOWED_URI =
  /^(?:(?:https?:)?\/\/|https?:|\/|\.\/|\.\.\/|#|data:image\/(?:png|jpe?g|gif|webp);base64,|[^:]*$)/i;
const VISUAL_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ["style"],
  ADD_ATTR: ["style"],
  FORCE_BODY: true,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
  FORBID_ATTR: ["srcdoc"],
  ALLOWED_URI_REGEXP: VISUAL_ALLOWED_URI,
};
export function initVisuals(hooks) {
  visualHooks = Object.assign(defaultVisualHooks(), hooks || {});
}
export function disposeVisuals() {
  for (let i = 0; i < mermaidControllers.length; i++) mermaidControllers[i].dispose();
  disposeLightbox();
  visualSurfaceCaches = {};
  visualHooks = defaultVisualHooks();
  mermaidRuntimePromise = null;
  mermaidRenderQueue = Promise.resolve();
  mermaidControllers = [];
  mermaidGeneration += 1;
  if (mermaidThemeObserver) mermaidThemeObserver.disconnect();
  mermaidThemeObserver = null;
}
export function registerBlockMount(type, mountSpec) {
  const key = String(type || "").toLowerCase();
  const descriptor = getBlockType(key);
  if (!descriptor) throw new Error('Cannot register mount for unknown block type "' + key + '"');
  if (!mountSpec || typeof mountSpec !== "object")
    throw new TypeError('Block mount for "' + key + '" must be an object');
  if (descriptor.security === "sanitize-html" && typeof mountSpec.renderHtml !== "function") {
    throw new TypeError('Block mount for "' + key + '" must provide renderHtml(model)');
  }
  if (mountSpec.wire !== undefined && typeof mountSpec.wire !== "function") {
    throw new TypeError('Block mount wire for "' + key + '" must be a function');
  }
  blockMounts[key] = mountSpec;
}
function ensureVisualSanitizer() {
  const purifier = window.DOMPurify;
  if (!purifier || typeof purifier.sanitize !== "function") throw new Error("DOMPurify is unavailable");
  if (!visualHooksReady && typeof purifier.addHook === "function") {
    purifier.addHook("uponSanitizeAttribute", function (node, data) {
      if (data && data.attrName && /^on/i.test(data.attrName)) data.keepAttr = false;
    });
    visualHooksReady = true;
  }
  return purifier;
}
function sanitizeVisualSource(source) {
  return ensureVisualSanitizer().sanitize(source, VISUAL_SANITIZE_CONFIG);
}
function decodeVisualSource(encoded) {
  const bin = atob(String(encoded || ""));
  if (utf8Decoder) {
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return utf8Decoder.decode(bytes);
  }
  try {
    return decodeURIComponent(escape(bin));
  } catch (e) {
    return bin;
  }
}
function visualCacheKey(type, encoded) {
  return String(type || "") + "\n" + String(encoded || "");
}
function visualFallback(source, message) {
  const wrap = document.createElement("div");
  wrap.className = "viz-fallback";
  const note = document.createElement("div");
  note.className = "viz-fallback-note";
  note.textContent = message || "Unable to render visual. Showing source.";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = String(source || "");
  pre.appendChild(code);
  wrap.appendChild(note);
  wrap.appendChild(pre);
  return wrap;
}
function buildShowVisual(model) {
  return String(model == null ? "" : model);
}

function buildMermaidVisual() {
  return '<div class="rh-mermaid" role="img" aria-label="Mermaid diagram"><span class="rh-mermaid-loading">Drawing diagram…</span></div>';
}

function currentMermaidTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

function loadMermaidRuntime() {
  if (!mermaidRuntimePromise) {
    mermaidRuntimePromise = Promise.resolve()
      .then(function () {
        return visualHooks.loadMermaid();
      })
      .then(function (runtime) {
        if (!runtime || typeof runtime.initialize !== "function" || typeof runtime.render !== "function") {
          throw new Error("Mermaid runtime does not expose initialize() and render()");
        }
        return runtime;
      })
      .catch(function (error) {
        mermaidRuntimePromise = null;
        throw error;
      });
  }
  return mermaidRuntimePromise;
}

function showMermaidFallback(target, source) {
  target.textContent = "";
  target.classList.remove("is-rendered");
  target.removeAttribute("role");
  target.removeAttribute("aria-label");
  target.appendChild(visualFallback(source, "Mermaid could not render this diagram. Showing source."));
}

function mermaidAccessibleName(svg) {
  return (
    String(svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "Mermaid diagram").trim() ||
    "Mermaid diagram"
  );
}

function cloneMermaidSvg(svg) {
  const clone = svg.cloneNode(true);
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.style.removeProperty("width");
  clone.style.removeProperty("height");
  clone.style.removeProperty("max-width");
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  clone.classList.add("rh-lightbox-diagram");
  return clone;
}

function openMermaidLightbox(controller, target, trigger) {
  const svg = target.querySelector("svg");
  if (!svg || !target.classList.contains("is-rendered")) return;
  const label = mermaidAccessibleName(svg);
  controller.lightbox = openLightbox({
    content: cloneMermaidSvg(svg),
    label: label,
    trigger: trigger,
    variant: "diagram",
  });
}

function mountMermaidAffordance(controller, target, svg) {
  target.classList.add("is-rendered");
  target.removeAttribute("role");
  target.removeAttribute("aria-label");
  let button = target.querySelector("button.rh-mermaid-expand");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "rh-mermaid-expand";
    button.setAttribute("aria-label", "Open diagram fullscreen");
    button.title = "Open fullscreen";
    button.innerHTML = iconSvg("expand");
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openMermaidLightbox(controller, target, button);
    });
    target.appendChild(button);
  }
  if (controller.lightbox && controller.lightbox.isOpen()) {
    controller.lightbox.replaceContent(cloneMermaidSvg(svg));
  }
}

function wireMermaidSurface(controller, target) {
  let start = null;
  function onPointerdown(e) {
    start = null;
    if (
      !target.classList.contains("is-rendered") ||
      e.button !== 0 ||
      e.isPrimary === false ||
      e.target.closest?.(".rh-mermaid-expand")
    )
      return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerup(e) {
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (dx * dx + dy * dy >= 25) return;
    const button = target.querySelector("button.rh-mermaid-expand");
    if (button) openMermaidLightbox(controller, target, button);
  }
  function onPointercancel() {
    start = null;
  }
  target.addEventListener("pointerdown", onPointerdown);
  target.addEventListener("pointerup", onPointerup);
  target.addEventListener("pointercancel", onPointercancel);
  return function () {
    target.removeEventListener("pointerdown", onPointerdown);
    target.removeEventListener("pointerup", onPointerup);
    target.removeEventListener("pointercancel", onPointercancel);
  };
}

function trackMermaidController(controller) {
  mermaidControllers.push(controller);
  if (mermaidThemeObserver || typeof MutationObserver !== "function") return;
  mermaidThemeObserver = new MutationObserver(function () {
    const live = [];
    for (let i = 0; i < mermaidControllers.length; i++) {
      const current = mermaidControllers[i];
      if (current.root && current.root.isConnected !== false) {
        live.push(current);
        current.render();
      }
    }
    mermaidControllers = live;
  });
  mermaidThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function wireMermaid(root, source) {
  const target = root.querySelector(".rh-mermaid");
  let renderVersion = 0;
  const generation = mermaidGeneration;
  const controller = {
    root: root,
    lightbox: null,
    dispose: function () {},
    render: function () {
      const version = ++renderVersion;
      mermaidRenderQueue = mermaidRenderQueue.then(async function () {
        try {
          const runtime = await loadMermaidRuntime();
          if (generation !== mermaidGeneration || version !== renderVersion || !target) return;
          runtime.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            htmlLabels: false,
            suppressErrorRendering: true,
            theme: currentMermaidTheme(),
            flowchart: { htmlLabels: false, useMaxWidth: true },
            sequence: { useMaxWidth: true },
          });
          const result = await runtime.render("rh-mermaid-" + ++mermaidRenderId, String(source || ""));
          if (generation !== mermaidGeneration || version !== renderVersion || !target) return;
          const rendered = document.createElement("div");
          rendered.innerHTML = sanitizeVisualSource((result && result.svg) || "");
          const svg = rendered.querySelector("svg");
          if (!svg) throw new Error("Mermaid produced no SVG");
          svg.setAttribute("role", "img");
          if (!svg.getAttribute("aria-label")) svg.setAttribute("aria-label", "Mermaid diagram");
          const previous = target.querySelector("svg");
          if (previous && target.classList.contains("is-rendered")) previous.replaceWith(svg);
          else {
            target.textContent = "";
            target.appendChild(svg);
          }
          mountMermaidAffordance(controller, target, svg);
        } catch (e) {
          if (generation === mermaidGeneration && version === renderVersion && target)
            showMermaidFallback(target, source);
        }
      });
    },
  };
  controller.dispose = wireMermaidSurface(controller, target);
  trackMermaidController(controller);
  controller.render();
}

function buildMountedVisual(descriptor, mountSpec, model, context) {
  const host = document.createElement("div");
  host.className = "viz-mounted viz-" + descriptor.type;
  host.setAttribute("data-viz-mounted", descriptor.type);
  host.style.contain = descriptor.type === "mermaid" ? "layout style" : "content";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = visualStylesFor(descriptor.type);
  const frame = document.createElement("div");
  frame.className = "rh-viz-frame";
  const content = document.createElement("div");
  content.className = "rh-viz-content";
  if (descriptor.security === "sanitize-html") {
    content.innerHTML = sanitizeVisualSource(mountSpec.renderHtml(model));
  } else {
    content.textContent = descriptor.toPlainText(model);
  }
  frame.appendChild(content);
  shadow.appendChild(style);
  shadow.appendChild(frame);
  if (mountSpec.wire) mountSpec.wire(content, model, context);
  return host;
}
function getSurfaceCache(surfaceKey) {
  const key = String(surfaceKey || "default");
  if (!visualSurfaceCaches[key]) visualSurfaceCaches[key] = {};
  return visualSurfaceCaches[key];
}
export function mountVisuals(containerEl, surfaceKey) {
  if (!containerEl || !containerEl.querySelectorAll) return;
  const placeholders = containerEl.querySelectorAll(".viz");
  if (!placeholders.length) {
    if (surfaceKey && visualSurfaceCaches[surfaceKey]) visualSurfaceCaches[surfaceKey] = {};
    return;
  }
  const cache = getSurfaceCache(surfaceKey);
  const present = {};
  const idCounts = {};
  const used = {};
  const mountable = [];
  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];
    if (ph.classList && ph.classList.contains("viz-pending")) continue;
    const type = String(ph.getAttribute("data-viz") || "").toLowerCase();
    const encoded = ph.getAttribute("data-src") || "";
    if (!type || !encoded) continue;
    const blockId = ph.getAttribute("data-block-id") || "";
    const key = blockId ? "id\n" + blockId : visualCacheKey(type, encoded);
    if (blockId) idCounts[blockId] = (idCounts[blockId] || 0) + 1;
    present[key] = (present[key] || 0) + 1;
    mountable.push({ el: ph, type: type, encoded: encoded, key: key, blockId: blockId });
  }
  for (let d = 0; d < mountable.length; d++) {
    const candidate = mountable[d];
    if (candidate.blockId && idCounts[candidate.blockId] > 1) {
      present[candidate.key] -= 1;
      candidate.key = visualCacheKey(candidate.type, candidate.encoded);
      present[candidate.key] = (present[candidate.key] || 0) + 1;
      candidate.blockId = "";
    }
  }
  for (let m = 0; m < mountable.length; m++) {
    let item = mountable[m];
    const idx = used[item.key] || 0;
    used[item.key] = idx + 1;
    if (!cache[item.key]) cache[item.key] = [];
    let mounted = cache[item.key][idx];
    const signature = visualCacheKey(item.type, item.encoded);
    if (mounted && mounted.__rhVisualSignature !== signature) mounted = null;
    if (!mounted) {
      const descriptor = getBlockType(item.type);
      const mountSpec = blockMounts[item.type];
      let source;
      try {
        source = decodeVisualSource(item.encoded);
      } catch (e) {
        mounted = visualFallback("", "Unable to decode visual source.");
      }
      if (!mounted)
        try {
          const nodeId = String(
            (item.el.closest && item.el.closest("[data-node-id]")?.getAttribute("data-node-id")) ||
              (item.key &&
                String(surfaceKey || "")
                  .split(":")
                  .slice(1)
                  .join(":")) ||
              "",
          );
          const node = visualHooks.getNode(nodeId);
          const learn = node && node.progress;
          const currentState = item.blockId && learn && typeof learn === "object" ? learn[item.blockId] : null;
          const context = {
            node_id: nodeId,
            block_id: item.blockId,
            state: currentState && typeof currentState === "object" ? currentState : {},
            recordBlockState: function (nextState) {
              if (!item.blockId || !nodeId) return Promise.resolve({ ok: true });
              if (node) {
                node.progress = node.progress && typeof node.progress === "object" ? node.progress : {};
                node.progress[item.blockId] = Object.assign({}, node.progress[item.blockId] || {}, nextState);
              }
              return Promise.resolve(
                visualHooks.post({ type: "block_state", node_id: nodeId, block_id: item.blockId, state: nextState }),
              );
            },
          };
          mounted =
            descriptor && mountSpec
              ? buildMountedVisual(descriptor, mountSpec, descriptor.parse(source), context)
              : visualFallback(source, "Unsupported visual type. Showing source.");
        } catch (e) {
          mounted = visualFallback(source, "Unable to render visual. Showing source.");
        }
      mounted.__rhVisualSignature = signature;
      cache[item.key][idx] = mounted;
    }
    if (item.el.parentNode) item.el.parentNode.replaceChild(mounted, item.el);
  }
  for (const ckey in cache) {
    if (!Object.prototype.hasOwnProperty.call(cache, ckey)) continue;
    if (!present[ckey]) delete cache[ckey];
    else cache[ckey].length = present[ckey];
  }
}

registerBlockMount("show", { renderHtml: buildShowVisual });
registerBlockMount("mermaid", { renderHtml: buildMermaidVisual, wire: wireMermaid });

export function buildCheckVisual(model) {
  const options = model.options
    .map(function (option, index) {
      return (
        BUTTON_OPEN +
        ' class="rh-check-option" type="button" data-option="' +
        index +
        '">' +
        escapeHtml(option ?? "") +
        "</button>"
      );
    })
    .join("");
  return (
    '<section class="rh-check"><div class="rh-check-question">' +
    escapeHtml(model.question ?? "") +
    '</div><div class="rh-check-options">' +
    options +
    '</div><div class="rh-check-explanation" hidden>' +
    escapeHtml(model.explanation || "") +
    '</div><div class="rh-check-actions" hidden>' +
    BUTTON_OPEN +
    ' class="rh-check-reset" type="button">Try again</button></div></section>'
  );
}

function wireCheck(root, model, ctx) {
  const options = Array.from(root.querySelectorAll(".rh-check-option"));
  const explanation = root.querySelector(".rh-check-explanation");
  const actions = root.querySelector(".rh-check-actions");
  const reset = root.querySelector(".rh-check-reset");
  const state = ctx && ctx.state && typeof ctx.state === "object" ? ctx.state : {};
  let attempts = Number.isInteger(state.attempts) && state.attempts >= 0 ? state.attempts : 0;
  let currentLast = state.last || null;
  function paint(last, revealed) {
    options.forEach(function (button, index) {
      button.disabled = !!revealed;
      button.classList.remove("is-correct", "is-incorrect");
      button.removeAttribute("aria-pressed");
      if (revealed && last && index === last.option) {
        button.classList.add(last.correct ? "is-correct" : "is-incorrect");
        button.setAttribute("aria-pressed", "true");
      }
      if (revealed && index === model.answer) button.classList.add("is-correct");
    });
    explanation.hidden = !revealed;
    actions.hidden = !revealed;
  }
  paint(state.last, state.revealed === true);
  options.forEach(function (button, index) {
    button.addEventListener("click", function () {
      if (button.disabled) return;
      attempts += 1;
      const last = { option: index, correct: index === model.answer };
      currentLast = last;
      paint(last, true);
      if (ctx) ctx.recordBlockState({ attempts: attempts, last: last, revealed: true });
    });
  });
  reset.addEventListener("click", function () {
    paint(null, false);
    options[0]?.focus();
    if (ctx) ctx.recordBlockState({ attempts: attempts, last: currentLast, revealed: false });
  });
}

registerBlockMount("check", { renderHtml: buildCheckVisual, wire: wireCheck });
