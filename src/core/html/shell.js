import { buttonMarkup, composerActionsMarkup, iconButtonMarkup } from "./button-markup.js";
import { iconSvg } from "./icons.js";

/*
 * Extracted from the former canvas.js monolith. Keep this string as the exact
 * self-contained browser payload; behavior is verified by the inline-script
 * node --check gate.
 */
/*
 * The three folds a card offers, rendered identically into the ⋯ menu and into
 * the collapse button's own right-click menu. Every row wears the same
 * minus/plus the card header wears, because each is that button applied to a
 * different scope: the card, the card plus its subtree ("branch", as in Delete
 * branch), and the subtree alone. Labels and glyphs are swapped per row at open
 * time by the canvas; the two subtree rows are hidden on a childless card.
 * @param {string} prefix
 */
function collapseGroupMarkup(/** @type {string} */ prefix) {
  const row = (/** @type {string} */ id, /** @type {string} */ label) => buttonMarkup({ bare: true, className: "sm-item", id: prefix + id, role: "menuitem", tabIndex: -1,
    label: label, labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("collapse") + '</span>' });
  return row("collapse", "Collapse") + row("collapse-branch", "Collapse branch") + row("collapse-children", "Collapse children");
}

export const CANVAS_SHELL = `
<div id="taskbar">
  <div class="tb-pill" id="tb-tools">
    <!-- The rail and New Rabbithole belong to the web app, which owns a library of
         holes and can create one. Under MCP the agent opens the hole and there is no
         library to browse, so the web shell injects those two itself (renderShell). -->
    <span id="tb-app"></span>
    <span class="sep" id="app-view-sep"></span>
    <!-- There is no Reader/Canvas toggle: the canvas is the place and the
         reader is the current card maximized. You enter by expanding a card
         and leave through Back to canvas in the session cluster (or Esc). -->
    <span class="tb-group" data-mode="reader">
      ${buttonMarkup({ id: "r-textdown", title: "Decrease reading size", ariaLabel: "Decrease reading size", label: "A−" })}
      ${buttonMarkup({ id: "r-textup", title: "Increase reading size", ariaLabel: "Increase reading size", label: "A+" })}
    </span>
    <span class="tb-group" data-mode="canvas">
      <span class="zoom-controls">
        ${iconButtonMarkup({ id: "t-zout", title: "Zoom out", ariaLabel: "Zoom out", svgIconHtml: iconSvg("zoom-out") })}
        ${buttonMarkup({ id: "zoom-label", title: "Zoom to 100%", ariaLabel: "Zoom to 100%", label: "100%" })}
        ${iconButtonMarkup({ id: "t-zin", title: "Zoom in", ariaLabel: "Zoom in", svgIconHtml: iconSvg("zoom-in") })}
      </span>
      ${iconButtonMarkup({ id: "t-tidy", title: "Tidy up layout · T", ariaLabel: "Tidy up layout · T", svgIconHtml: iconSvg("tidy") })}
    </span>
  </div>
  <div id="tb-document" aria-label="Document controls"></div>
  <div id="tb-session">
    <!-- The way back from a maximized document: sits left of the shared
         session controls and only exists while the reader is up. -->
    <div class="tb-pill" id="tb-restore-pill">
      ${buttonMarkup({ id: "reader-restore", title: "Back to canvas · Esc", ariaLabel: "Back to canvas", label: "Back to canvas", svgIconHtml: iconSvg("contract") })}
    </div>
    <div class="tb-pill">
    <span id="context-usage" hidden aria-live="polite"></span>
    <span class="sep" id="context-usage-sep" hidden aria-hidden="true"></span>
    ${iconButtonMarkup({ id: "t-share", title: "Share and export", ariaLabel: "Share and export", ariaHaspopup: "menu", ariaControls: "sharemenu", ariaExpanded: "false", svgIconHtml: iconSvg("share") })}
    ${iconButtonMarkup({ id: "t-theme", title: "Toggle theme", ariaLabel: "Toggle theme", svgIconHtml: iconSvg("theme") })}
    ${iconButtonMarkup({ id: "t-settings", title: "Model settings", ariaLabel: "Model settings", ariaExpanded: "false", svgIconHtml: iconSvg("settings") })}
    </div>
    <div class="tb-pill" id="tb-done-pill">
      ${buttonMarkup({ id: "tb-done", title: "End the session (the hole stays saved)", label: "Done" })}
    </div>
  </div>
</div>

<div id="reader">
  <div id="reader-workspace">
    <div id="reader-document">
      <div id="reader-main"></div>
      <div id="composer">
        <div class="composer-inner followup-composer" id="composer-inner">
          <div class="ask-input"><textarea id="composer-text" rows="1" placeholder="Ask or note…"></textarea></div>
          ${composerActionsMarkup({ id: "composer-actions" })}
        </div>
      </div>
    </div>
    <aside id="reader-rail" aria-labelledby="reader-rail-title">
      <div class="reader-rail-head"><span id="reader-rail-title">Branches</span><span id="reader-rail-count">0</span></div>
      <div id="margin-notes"></div>
    </aside>
  </div>
</div>

<div id="viewport"><div id="canvas-gesture-plane" aria-hidden="true"></div><div id="world"><svg id="edges"></svg></div></div>

<div id="ask">
  <div class="ask-input">
    <textarea id="ask-text" rows="1" placeholder="Ask or note…"></textarea>
  </div>
  ${composerActionsMarkup({ id: "ask-actions" })}
</div>

<div id="palette" hidden><div id="palette-panel">
  <div class="pal-input">
    ${iconSvg("search")}
    <input id="pal-text" placeholder="Search this Rabbithole…" aria-label="Search this Rabbithole" aria-controls="pal-results" aria-autocomplete="list" autocomplete="off" spellcheck="false">
    <kbd>esc</kbd>
  </div>
  <div id="pal-results" role="listbox" aria-label="Search results"></div>
</div></div>

<div id="sharemenu" class="anchored-menu" role="menu" aria-label="Share and export">
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-trail", role: "menuitem", tabIndex: -1, label: "Copy trail as Markdown", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("trail") + '</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-doc", role: "menuitem", tabIndex: -1, label: "Copy document as Markdown", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("copy") + '</span>' })}
  <div class="sm-sep"></div>
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-export", role: "menuitem", tabIndex: -1, label: "Download snapshot (.html)", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("download") + '</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-portable", role: "menuitem", tabIndex: -1, label: "Export Rabbithole (.rabbithole)", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("package") + '</span>' })}
</div>

<div id="cardmenu" class="anchored-menu" role="menu" aria-label="Card actions">
  <div class="cm-size-row">
    <span class="cm-size-label">Text size</span>
    <span class="cm-size-stepper">
      ${buttonMarkup({ bare: true, className: "cm-text-btn", id: "cm-textdown", role: "menuitem", tabIndex: -1, ariaLabel: "Decrease text size", label: "A−" })}
      ${buttonMarkup({ bare: true, className: "cm-text-btn cm-text-value", id: "cm-textreset", role: "menuitem", tabIndex: -1, ariaLabel: "Reset text size to 100%", label: "100%" })}
      ${buttonMarkup({ bare: true, className: "cm-text-btn", id: "cm-textup", role: "menuitem", tabIndex: -1, ariaLabel: "Increase text size", label: "A+" })}
    </span>
  </div>
  <div class="sm-sep"></div>
  ${buttonMarkup({ bare: true, className: "sm-item", id: "cm-copy", role: "menuitem", tabIndex: -1, label: "Copy as Markdown", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("copy") + '</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "cm-rename", role: "menuitem", tabIndex: -1, label: "Rename", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("rename") + '</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "cm-convert", role: "menuitem", tabIndex: -1, label: "Convert to Ask", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("question") + '</span>' })}
  <div class="sm-sep"></div>
  ${collapseGroupMarkup("cm-")}
  <div class="sm-sep cm-delete-sep"></div>
  ${buttonMarkup({ bare: true, className: "sm-item danger", id: "cm-delete", role: "menuitem", tabIndex: -1, label: "Delete branch", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("delete") + '</span>' })}
</div>

<!-- Right-clicking a card's collapse button opens the same three folds the ⋯
     menu carries, anchored to the button the gesture started from. -->
<div id="collapsemenu" class="anchored-menu" role="menu" aria-label="Collapse actions">
  ${collapseGroupMarkup("cc-")}
</div>

<div id="branch-undo"><span data-notice-message></span>${buttonMarkup({ bare: true, label: "Undo", hidden: true, dataAttrs: { noticeAction: "" } })}</div>

<div id="banner"><div class="banner-body"><span class="banner-title" id="banner-title" data-notice-title></span><span id="banner-msg" data-notice-message></span></div>${iconButtonMarkup({ bare: true, id: "banner-x", title: "Dismiss", ariaLabel: "Dismiss banner", icon: "×", dataAttrs: { noticeDismiss: "" } })}</div>
<div id="hint" data-notice-message></div>
`;
