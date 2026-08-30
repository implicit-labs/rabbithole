/*
 * Preferences that belong to the reader, not the document.
 *
 * Theme and global reading size describe the eyes and the monitor in front of
 * the page — not the thing being read. They live in localStorage and never
 * enter the hole document, the node_update wire, exports, or the portable
 * format. Per-node `font_scale` is the authorial counterpart and stays in the
 * doc; the two compose (see fontPx in core.js).
 */

import { ASK_PRESET_KEYS, DEFAULT_ASK_PRESETS } from "../core/hole/lens.js";

const THEME_KEY = "rh-theme";
const READING_SCALE_KEY = "rh-reading-scale";
export const ASK_PRESETS_KEY = "rh-ask-presets-v1";

export const READING_SCALE_MIN = 0.8;
export const READING_SCALE_MAX = 1.4;
export const READING_SCALE_STEP = 0.1;

const listeners = [];
let systemThemeMql = null;
let readingScaleCache = null;
let swapFrame = 0;
let askPresetsCache = null;

/*
 * A frozen snapshot is often opened from a file or a data document where
 * localStorage throws. The preference still has to hold for the life of the
 * page, so an unwritable store falls back to memory rather than silently
 * refusing the change.
 */
const memory = Object.create(null);

function readStored(key) {
  // A value only lands in memory when the store refused it, so it is always
  // the more recent intent.
  if (memory[key] !== undefined) return memory[key];
  try {
    return localStorage.getItem(key) || "";
  } catch (error) {}
  return "";
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
    delete memory[key];
  } catch (error) {
    memory[key] = value;
  }
}

export function onPreferenceChange(handler) {
  if (typeof handler !== "function") return function () {};
  listeners.push(handler);
  return function () {
    const index = listeners.indexOf(handler);
    if (index !== -1) listeners.splice(index, 1);
  };
}

function notify(kind) {
  const snapshot = listeners.slice();
  for (let i = 0; i < snapshot.length; i++) {
    try {
      snapshot[i](kind);
    } catch (error) {}
  }
}

// ---------------------------------------------------------------- theme

/** The stored choice: "light", "dark", or "system" (the default). */
export function themePreference() {
  const saved = readStored(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function systemTheme() {
  try {
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

/** What the page actually paints right now. */
export function resolvedTheme() {
  const preference = themePreference();
  return preference === "system" ? systemTheme() : preference;
}

export function setThemePreference(value) {
  const next = value === "light" || value === "dark" ? value : "system";
  writeStored(THEME_KEY, next);
  applyTheme();
  notify("theme");
  return next;
}

/*
 * The taskbar button is a quick toggle, not a third state: pressing it always
 * commits an explicit light/dark choice and leaves "system" behind.
 */
export function toggleTheme() {
  return setThemePreference(resolvedTheme() === "dark" ? "light" : "dark");
}

export function applyTheme() {
  const root = document.documentElement;
  const resolved = resolvedTheme();
  if (root.getAttribute("data-theme") !== resolved) suppressColorTransitions(root);
  root.setAttribute("data-theme", resolved);
  syncSystemThemeListener();
  return resolved;
}

/*
 * Every surface animates its colours; swapping the whole palette through those
 * transitions smears the page for a frame. Kill them for exactly the swap.
 */
function suppressColorTransitions(root) {
  root.classList.add("theme-swapping");
  const clear = function () {
    swapFrame = 0;
    root.classList.remove("theme-swapping");
  };
  if (swapFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(swapFrame);
  if (typeof requestAnimationFrame !== "function") {
    clear();
    return;
  }
  swapFrame = requestAnimationFrame(function () {
    swapFrame = requestAnimationFrame(clear);
  });
}

function onSystemThemeChange() {
  if (themePreference() !== "system") return;
  applyTheme();
  notify("theme");
}

function syncSystemThemeListener() {
  const wanted = themePreference() === "system";
  if (wanted && !systemThemeMql) {
    try {
      systemThemeMql = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
    } catch (error) {
      systemThemeMql = null;
    }
    if (!systemThemeMql) return;
    if (systemThemeMql.addEventListener) systemThemeMql.addEventListener("change", onSystemThemeChange);
    else if (systemThemeMql.addListener) systemThemeMql.addListener(onSystemThemeChange);
    return;
  }
  if (!wanted && systemThemeMql) {
    if (systemThemeMql.removeEventListener) systemThemeMql.removeEventListener("change", onSystemThemeChange);
    else if (systemThemeMql.removeListener) systemThemeMql.removeListener(onSystemThemeChange);
    systemThemeMql = null;
  }
}

// -------------------------------------------------------- reading size

export function clampReadingScale(value) {
  const numeric = typeof value === "number" ? value : parseFloat(value);
  if (!isFinite(numeric)) return 1;
  return Math.round(Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, numeric)) * 100) / 100;
}

export function readingScale() {
  if (readingScaleCache === null) readingScaleCache = clampReadingScale(readStored(READING_SCALE_KEY));
  return readingScaleCache;
}

export function setReadingScale(value) {
  const next = clampReadingScale(value);
  readingScaleCache = next;
  writeStored(READING_SCALE_KEY, String(next));
  notify("reading-scale");
  return next;
}

// ------------------------------------------------------------ ask presets

const PRESET_KEY_ALIASES = Object.freeze({
  explain: "explain",
  eli5: "eli5",
  example: "example",
  "explain-example": "example",
  explain_example: "example",
  explain_with_example: "example",
  deeper: "deeper",
  "go-deeper": "deeper",
  go_deeper: "deeper",
});

function clonePresetDefaults() {
  return {
    version: 1,
    linked: false,
    selection: Object.fromEntries(
      ASK_PRESET_KEYS.map((key) => [
        key,
        {
          label: DEFAULT_ASK_PRESETS.selection[key].label,
          instruction: DEFAULT_ASK_PRESETS.selection[key].instruction,
          removed: false,
        },
      ]),
    ),
    followup: Object.fromEntries(
      ASK_PRESET_KEYS.map((key) => [
        key,
        {
          label: DEFAULT_ASK_PRESETS.followup[key].label,
          instruction: DEFAULT_ASK_PRESETS.followup[key].instruction,
          removed: false,
        },
      ]),
    ),
  };
}

function normalizedPresetKey(value) {
  return (
    PRESET_KEY_ALIASES[
      String(value || "")
        .trim()
        .toLowerCase()
    ] || null
  );
}

function normalizePresetSet(value, defaults) {
  const out = { ...defaults };
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [entry?.key ?? entry?.id ?? ASK_PRESET_KEYS[index], entry])
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  for (const [rawKey, rawPreset] of entries) {
    const key = normalizedPresetKey(rawKey);
    if (!key || !rawPreset || typeof rawPreset !== "object" || Array.isArray(rawPreset)) continue;
    const label = String(rawPreset.label ?? "").trim();
    const instruction = String(rawPreset.instruction ?? rawPreset.q ?? "").trim();
    if (label && instruction)
      out[key] = {
        label: label.slice(0, 80),
        instruction: instruction.slice(0, 4000),
        removed: rawPreset.removed === true,
      };
  }
  return out;
}

/** Migrate and validate storage only here; callers always receive v1 canonical keys. */
export function normalizeAskPresets(value) {
  const defaults = clonePresetDefaults();
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacySets = raw.presets && typeof raw.presets === "object" ? raw.presets : raw;
  const shared = legacySets.lenses || legacySets.default || null;
  return {
    version: 1,
    linked: raw.linked === true,
    selection: normalizePresetSet(legacySets.selection || shared, defaults.selection),
    followup: normalizePresetSet(legacySets.followup || legacySets.followups || shared, defaults.followup),
  };
}

export function askPresets() {
  if (!askPresetsCache) {
    let parsed = null;
    try {
      parsed = JSON.parse(readStored(ASK_PRESETS_KEY));
    } catch (error) {}
    askPresetsCache = normalizeAskPresets(parsed);
  }
  return askPresetsCache;
}

/*
 * The link resolves here, at the single read point, so every consumer — the
 * live button rows, badge labels, and the wire instruction — follows the
 * toggle without knowing it exists. The stored follow-up set is untouched
 * while linked; unlinking restores it exactly.
 */
export function askPreset(set, key) {
  let setKey = set === "selection" ? "selection" : "followup";
  if (setKey === "followup" && askPresets().linked) setKey = "selection";
  const presetKey = normalizedPresetKey(key);
  return presetKey ? askPresets()[setKey][presetKey] : null;
}

export function askPresetsLinked() {
  return askPresets().linked === true;
}

/** The keys a surface actually shows, in row order — removal follows the link. */
export function visibleAskPresetKeys(set) {
  return ASK_PRESET_KEYS.filter((key) => askPreset(set, key)?.removed !== true);
}

export function setAskPresetsLinked(value) {
  const next = value === true;
  const current = askPresets();
  if (current.linked === next) return next;
  askPresetsCache = { ...current, linked: next };
  writeStored(ASK_PRESETS_KEY, JSON.stringify(askPresetsCache));
  notify("ask-presets");
  return next;
}

export function setAskPreset(set, key, value) {
  const setKey = set === "selection" ? "selection" : "followup";
  const presetKey = normalizedPresetKey(key);
  if (!presetKey) return null;
  const current = askPresets();
  const existing = current[setKey][presetKey];
  const label = String(value?.label ?? existing.label)
    .trim()
    .slice(0, 80);
  const instruction = String(value?.instruction ?? existing.instruction)
    .trim()
    .slice(0, 4000);
  const removed = typeof value?.removed === "boolean" ? value.removed : existing.removed === true;
  if (!label || !instruction) return existing;
  askPresetsCache = {
    version: 1,
    linked: current.linked === true,
    selection: { ...current.selection },
    followup: { ...current.followup },
    [setKey]: { ...current[setKey], [presetKey]: { label, instruction, removed } },
  };
  writeStored(ASK_PRESETS_KEY, JSON.stringify(askPresetsCache));
  notify("ask-presets");
  return askPresetsCache[setKey][presetKey];
}

export function setAskPresetRemoved(set, key, value) {
  return setAskPreset(set, key, { removed: value === true });
}

export function resetAskPreset(set, key) {
  const setKey = set === "selection" ? "selection" : "followup";
  const presetKey = normalizedPresetKey(key);
  if (!presetKey) return null;
  return setAskPreset(setKey, presetKey, { ...DEFAULT_ASK_PRESETS[setKey][presetKey], removed: false });
}
