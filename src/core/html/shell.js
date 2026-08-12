import { buttonMarkup, composerActionsMarkup, iconButtonMarkup } from "./button-markup.js";
import { iconSvg } from "./icons.js";

/*
 * Extracted from the former canvas.js monolith. Keep this string as the exact
 * self-contained browser payload; behavior is verified by the inline-script
 * node --check gate.
 */
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
      ${buttonMarkup({ id: "r-textdown", title: "Smaller text", label: "A−" })}
      ${buttonMarkup({ id: "r-textup", title: "Larger text", label: "A+" })}
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

<div id="sharemenu" role="menu" aria-label="Share and export">
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-trail", role: "menuitem", tabIndex: -1, label: "Copy trail as Markdown", svgIconHtml: '<span class="sm-ic">⤷</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-doc", role: "menuitem", tabIndex: -1, label: "Copy document as Markdown", svgIconHtml: '<span class="sm-ic">⧉</span>' })}
  <div class="sm-sep"></div>
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-export", role: "menuitem", tabIndex: -1, label: "Download snapshot (.html)", svgIconHtml: '<span class="sm-ic">⇩</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "sm-portable", role: "menuitem", tabIndex: -1, label: "Export Rabbithole (.rabbithole)", svgIconHtml: '<span class="sm-ic">⇣</span>' })}
</div>

<div id="confirm">
  <div class="cf-msg" id="cf-msg"></div>
  <div class="cf-row">${buttonMarkup({ bare: true, id: "cf-keep", label: "Keep" })}${buttonMarkup({ bare: true, className: "cf-remove", id: "cf-remove", label: "Remove" })}</div>
</div>

<div id="banner"><div class="banner-body"><span class="banner-title" id="banner-title" data-notice-title></span><span id="banner-msg" data-notice-message></span></div>${iconButtonMarkup({ bare: true, id: "banner-x", title: "Dismiss", ariaLabel: "Dismiss banner", icon: "×", dataAttrs: { noticeDismiss: "" } })}</div>
<div id="hint" data-notice-message></div>
`;
