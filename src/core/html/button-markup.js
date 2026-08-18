import { escapeHtml } from "../utils.js";

const STATEFUL_ARIA = ["aria-haspopup", "aria-controls", "aria-expanded", "aria-pressed"];

/** @typedef {Record<string, any>} ButtonOptions */

/** @param {string} name @param {unknown} value */
function attribute(name, value) {
  if (value === undefined || value === false || value === null) return "";
  return " " + name + (value === true ? "" : '="' + escapeHtml(String(value)) + '"');
}

/** @param {ButtonOptions} options @param {boolean} iconOnly */
function buttonAttributes(options, iconOnly) {
  const label = String(options.label || "").trim();
  const ariaLabel = String(options.ariaLabel || "").trim();
  if (iconOnly && !ariaLabel) throw new Error("IconButton requires aria-label");
  if (!iconOnly && !label && !ariaLabel) throw new Error("Button requires an accessible name");

  const baseClass = options.bare ? "" : (iconOnly ? "tool-btn tool-icon" : "tool-btn");
  const className = [baseClass, options.className].filter(Boolean).join(" ");
  let result = attribute("class", className || undefined) +
    attribute("id", options.id) +
    attribute("type", "button") +
    attribute("role", options.role) +
    attribute("tabindex", options.tabIndex) +
    attribute("title", options.title) +
    attribute("aria-label", ariaLabel || undefined);
  for (const [name, value] of Object.entries(options.dataAttrs || {})) {
    const attrName = "data-" + String(name).replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    result += attribute(attrName, value);
  }
  for (const name of STATEFUL_ARIA) {
    const camelName = name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    result += attribute(name, options[name] ?? options[camelName]);
  }
  const aria = options.aria || {};
  for (const [name, value] of Object.entries(aria)) {
    const attrName = name.startsWith("aria-") ? name : "aria-" + name;
    if (!STATEFUL_ARIA.includes(attrName) && attrName !== "aria-label") result += attribute(attrName, value);
  }
  return result + attribute("hidden", options.hidden) + attribute("disabled", options.disabled);
}

/** @param {ButtonOptions} [options] */
export function buttonMarkup(options = {}) {
  const rawLabel = String(options.label || "");
  const label = options.labelClass && rawLabel
    ? "<span" + attribute("class", options.labelClass) + ">" + escapeHtml(rawLabel) + "</span>"
    : escapeHtml(rawLabel);
  const content = (options.svgIconHtml || "") + label +
    (options.kbdHint ? "<kbd" + attribute("class", options.kbdClass) + ">" + escapeHtml(String(options.kbdHint)) + "</kbd>" : "");
  return "<button" + buttonAttributes(options, false) + ">" + content + "</button>";
}

// The one composer action row: four lenses at rest, the commit pair once a
// draft exists. Every composer surface (selection popover, reader composer,
// card drawer, standalone note/ask surface) renders this same commit markup;
// surfaces without a parent document omit lenses through the builder option.
/** @param {{ id?: string, className?: string, includeLenses?: boolean, noteEnterShortcut?: boolean,
 *   noteKbdHint?: string, askKbdHint?: string, noteTitle?: string, askTitle?: string,
 *   noteLabel?: string, askLabel?: string }} [options] */
export function composerActionsMarkup(options = {}) {
  const className = ["ask-actions", options.className].filter(Boolean).join(" ");
  const noteEnterShortcut = options.noteEnterShortcut !== false;
  const noteKbdHint = options.noteKbdHint ?? (noteEnterShortcut ? "↵" : undefined);
  const askKbdHint = options.askKbdHint ?? "⌘↵";
  const lenses = options.includeLenses === false ? "" :
    buttonMarkup({ bare: true, className: "lens", dataAttrs: { lens: "explain" }, label: "Explain ", kbdHint: "1" }) +
    buttonMarkup({ bare: true, className: "lens", dataAttrs: { lens: "eli5" }, label: "ELI5 ", kbdHint: "2" }) +
    buttonMarkup({ bare: true, className: "lens", dataAttrs: { lens: "example" }, label: "Example ", kbdHint: "3" }) +
    buttonMarkup({ bare: true, className: "lens", dataAttrs: { lens: "deeper" }, label: "Go Deeper ", kbdHint: "4" });
  return "<div" + attribute("class", className) + attribute("id", options.id) + ">" +
    lenses +
    '<div class="commit-actions">' +
    buttonMarkup({ bare: true, className: "ask-commit", dataAttrs: { commit: "note" },
      title: options.noteTitle ?? (noteEnterShortcut ? "Save note (Enter)" : "Save note"),
      label: (options.noteLabel ?? "Note") + " ", labelClass: "ask-commit-label", kbdHint: noteKbdHint }) +
    buttonMarkup({ bare: true, className: "ask-commit", dataAttrs: { commit: "ask" },
      title: options.askTitle ?? "Ask (Command/Control+Enter)",
      label: (options.askLabel ?? "Ask") + " ", labelClass: "ask-commit-label", kbdHint: askKbdHint }) +
    "</div></div>";
}

/** @param {ButtonOptions} [options] */
export function iconButtonMarkup(options = {}) {
  const content = options.svgIconHtml || escapeHtml(String(options.icon || ""));
  return "<button" + buttonAttributes(options, true) + ">" + content + "</button>";
}
