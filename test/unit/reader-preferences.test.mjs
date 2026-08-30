/** @protects reader preferences capability contracts. */
import assert from "node:assert/strict";

/*
 * Theme and global reading size belong to the reader, not the document. This
 * covers the pure part: clamping, the three-state theme, and the fact that a
 * store that refuses writes still holds the choice for the life of the page.
 */

const store = new Map();
let storageWritable = true;
(/** @type {any} */ (globalThis)).localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    if (!storageWritable) throw new Error("storage is unavailable");
    store.set(key, String(value));
  },
  removeItem: (key) => store.delete(key),
};

let systemPrefersDark = false;
const mediaListeners = new Set();
const root = {
  attributes: new Map(),
  classList: { add(){}, remove(){} },
  getAttribute(name){ return this.attributes.has(name) ? this.attributes.get(name) : null; },
  setAttribute(name, value){ this.attributes.set(name, value); },
};
(/** @type {any} */ (globalThis)).document = { documentElement: root };
(/** @type {any} */ (globalThis)).window = {
  matchMedia: (query) => ({
    matches: query.includes("dark") ? systemPrefersDark : false,
    addEventListener: (_type, handler) => mediaListeners.add(handler),
    removeEventListener: (_type, handler) => mediaListeners.delete(handler),
  }),
};
globalThis.matchMedia = globalThis.window.matchMedia;

const {
  READING_SCALE_MAX,
  READING_SCALE_MIN,
  applyTheme,
  ASK_PRESETS_KEY,
  askPreset,
  askPresetsLinked,
  setAskPresetsLinked,
  normalizeAskPresets,
  clampReadingScale,
  onPreferenceChange,
  readingScale,
  resolvedTheme,
  setReadingScale,
  setAskPreset,
  setAskPresetRemoved,
  visibleAskPresetKeys,
  resetAskPreset,
  setThemePreference,
  themePreference,
  toggleTheme,
} = await import("../../src/ui/preferences.js");

// ---- asking presets -------------------------------------------------------

const migratedPresets = normalizeAskPresets({
  lenses: {
    explain_with_example: { label: "Worked", q: "Use a worked example." },
    go_deeper: { label: "Mechanism", instruction: "Show the mechanism." },
  },
});
assert.deepEqual(migratedPresets.selection.example, { label: "Worked", instruction: "Use a worked example.", removed: false },
  "historical lens identifiers and q fields migrate at the storage boundary");
assert.deepEqual(migratedPresets.followup.deeper, { label: "Mechanism", instruction: "Show the mechanism.", removed: false });
assert.notEqual(migratedPresets.selection, migratedPresets.followup, "selection and follow-up sets are independent objects");

assert.equal(askPreset("selection", "explain").label, "Explain");
assert.equal(askPreset("selection", "explain").instruction, "Explain this further.",
  "default instructions are minimal — the model needs the move, not an essay");
assert.equal(askPreset("followup", "example").label, "Example");
setAskPreset("selection", "explain", { label: "Clarify", instruction: "Lead with the key distinction." });
assert.deepEqual(askPreset("selection", "explain"), { label: "Clarify", instruction: "Lead with the key distinction.", removed: false });
assert.equal(askPreset("followup", "explain").label, "Explain", "editing selection presets must not affect follow-ups");
assert.equal(JSON.parse(store.get(ASK_PRESETS_KEY)).version, 1, "asking preferences live in a versioned global key");
resetAskPreset("selection", "explain");
assert.equal(askPreset("selection", "explain").label, "Explain");

// ---- linked follow-ups ----------------------------------------------------

assert.equal(askPresetsLinked(), false, "the sets ship separate; linking is opt-in");
assert.equal(normalizeAskPresets({ linked: true }).linked, true, "the linked flag rides the same versioned key");
assert.equal(normalizeAskPresets({ linked: "yes" }).linked, false, "anything but true reads as unlinked");
setAskPreset("selection", "deeper", { label: "Mechanism", instruction: "Show the mechanism." });
setAskPreset("followup", "deeper", { label: "Own", instruction: "Follow-up flavored." });
setAskPresetsLinked(true);
assert.equal(askPresetsLinked(), true);
assert.deepEqual(askPreset("followup", "deeper"), { label: "Mechanism", instruction: "Show the mechanism.", removed: false },
  "while linked every follow-up read resolves to the selection preset — buttons, badges, and the wire all follow");
assert.equal(JSON.parse(store.get(ASK_PRESETS_KEY)).linked, true);
assert.equal(JSON.parse(store.get(ASK_PRESETS_KEY)).followup.deeper.label, "Own",
  "the stored follow-up set is untouched while linked");
setAskPresetsLinked(false);
assert.deepEqual(askPreset("followup", "deeper"), { label: "Own", instruction: "Follow-up flavored.", removed: false },
  "unlinking restores the follow-up customizations exactly");
resetAskPreset("selection", "deeper");
resetAskPreset("followup", "deeper");

// ---- removable presets ----------------------------------------------------

assert.deepEqual(visibleAskPresetKeys("selection"), ["explain", "eli5", "example", "deeper"],
  "every slot ships visible");
assert.equal(normalizeAskPresets(null).selection.explain.removed, false, "removal defaults off");
assert.equal(normalizeAskPresets({ selection: { eli5: { label: "ELI5", instruction: "x", removed: true } } }).selection.eli5.removed, true,
  "removal is a flag on the stored slot, not a hole in the set");
setAskPreset("selection", "eli5", { label: "Kid gloves", instruction: "Very simply." });
setAskPresetRemoved("selection", "eli5", true);
assert.deepEqual(visibleAskPresetKeys("selection"), ["explain", "example", "deeper"],
  "a removed preset leaves the visible row");
assert.equal(askPreset("selection", "eli5").label, "Kid gloves",
  "the removed slot keeps its words — old branch badges and restore both need them");
setAskPresetsLinked(true);
assert.deepEqual(visibleAskPresetKeys("followup"), ["explain", "example", "deeper"],
  "while linked, follow-up visibility follows selection removals");
setAskPresetsLinked(false);
assert.deepEqual(visibleAskPresetKeys("followup"), ["explain", "eli5", "example", "deeper"],
  "unlinked follow-ups keep their own full row");
setAskPresetRemoved("selection", "eli5", false);
assert.deepEqual(visibleAskPresetKeys("selection"), ["explain", "eli5", "example", "deeper"]);
assert.equal(askPreset("selection", "eli5").label, "Kid gloves", "restore brings back the customized words, not the default");
setAskPresetRemoved("selection", "eli5", true);
resetAskPreset("selection", "eli5");
assert.equal(askPreset("selection", "eli5").removed, false, "reset also returns a removed slot to the row");
assert.equal(askPreset("selection", "eli5").label, "ELI5");

// ---- reading size ---------------------------------------------------------

assert.equal(readingScale(), 1, "an unset reading size is 100%");
assert.equal(clampReadingScale(2.5), READING_SCALE_MAX, "reading size clamps at the top");
assert.equal(clampReadingScale(0.2), READING_SCALE_MIN, "reading size clamps at the bottom");
assert.equal(clampReadingScale("nonsense"), 1, "an unreadable stored value falls back to 100%");
assert.equal(clampReadingScale(1.0000000001), 1, "float drift never leaks into the displayed percentage");
assert.equal(clampReadingScale(1.15), 1.15, "a half step survives the round trip");

const seen = [];
const stopListening = onPreferenceChange((kind) => seen.push(kind));
assert.equal(setReadingScale(1.2), 1.2);
assert.equal(store.get("rh-reading-scale"), "1.2", "the global reading size lives in its own storage slot");
assert.equal(readingScale(), 1.2);
assert.equal(setReadingScale(9), READING_SCALE_MAX, "out-of-range input is clamped before it is stored");
setReadingScale(1);

// The composition the cards render: base x global x per-node font_scale.
const effective = (base, global, fontScale) => Math.round(base * global * fontScale);
assert.equal(effective(17, 1.2, 1.15), 23, "reader base 17 at global 120% and card 115%");
assert.equal(effective(14, 1.2, 1.15), 19, "canvas base 14 at global 120% and card 115%");
assert.equal(effective(14, 1, 1.15), 16, "the same card at global 100% is smaller — the two compose, neither replaces");

// ---- theme ----------------------------------------------------------------

assert.equal(themePreference(), "system", "no stored choice means the page follows the system");
systemPrefersDark = true;
assert.equal(resolvedTheme(), "dark");
applyTheme();
assert.equal(root.getAttribute("data-theme"), "dark", "system resolves to a painted theme");
assert.equal(mediaListeners.size, 1, "system mode listens for the system flipping under it");

systemPrefersDark = false;
mediaListeners.forEach((handler) => handler());
assert.equal(root.getAttribute("data-theme"), "light", "a system flip repaints while the preference stays system");
assert.equal(themePreference(), "system");

assert.equal(setThemePreference("dark"), "dark");
assert.equal(store.get("rh-theme"), "dark", "the theme keeps its existing storage slot");
assert.equal(root.getAttribute("data-theme"), "dark");
assert.equal(mediaListeners.size, 0, "an explicit choice stops following the system");

// The taskbar button is a quick toggle: it always commits an explicit choice.
setThemePreference("system");
systemPrefersDark = true;
applyTheme();
assert.equal(toggleTheme(), "light", "toggling out of system writes the opposite of what is painted");
assert.equal(themePreference(), "light");

assert.deepEqual(new Set(seen), new Set(["reading-scale", "theme"]), "both active listeners announce their changes");
stopListening();
const before = seen.length;
setReadingScale(1.1);
assert.equal(seen.length, before, "unsubscribing stops the announcements");

// ---- a store that refuses writes ------------------------------------------

storageWritable = false;
assert.equal(setThemePreference("dark"), "dark");
assert.equal(themePreference(), "dark", "a snapshot opened without localStorage still holds the choice");
assert.equal(setReadingScale(1.3), 1.3);
assert.equal(readingScale(), 1.3);
storageWritable = true;

console.log("reader preferences ok");
