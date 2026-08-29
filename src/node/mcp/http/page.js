/**
 * Self-contained page for a Rabbithole.
 *
 * The frontend is authored as three focused strings (styles, shell, browser
 * runtime) and assembled here into one HTML document. The output is still a
 * single-file page for live sessions and frozen exports.
 */

import { serializeForInlineScript } from "../../../core/utils.js";
import { assembleRabbitholePage } from "../../../core/html/document.js";
import { getDompurifyScript, getFrozenClientLiteral, getInlinePdfJsScript, getInlinePdfWorkerScript, getMermaidScript, getUiAssets } from "../../shared/dist-assets.js";
import { getCoreHtml } from "./assets.js";

export async function buildCanvasHtml(hydration) {
  const title = hydration?.title || "Rabbithole";
  const hydrationJson = serializeForInlineScript(hydration);
  const { stylesheetText, clientSource } = await getUiAssets();
  const { CANVAS_SHELL } = await getCoreHtml();
  const usesPdf = !!hydration?.nodes?.some((node) => node?.extensions?.pdf?.version === 2 && !node.extensions.pdf.converted);
  const pdfRuntimeCarriers = usesPdf
    ? `<script type="application/vnd.rabbithole+pdfjs" id="rabbithole-pdfjs-runtime">${getInlinePdfJsScript()}</script>
<script type="application/vnd.rabbithole+pdf-worker" id="rabbithole-pdf-worker-runtime">${getInlinePdfWorkerScript()}</script>`
    : "";
  const liveSnapshotSource = `  window.__RABBITHOLE_FROZEN_CLIENT__ = ${getFrozenClientLiteral()};\n`;
  const liveSnapshotHoleHook = `      getSnapshotHole: async function(){
        var response = await fetch("/snapshot-hole", { cache: "no-store" });
        if (!response.ok) throw new Error("Snapshot document is unavailable");
        return response.json();
      },\n`;

  const bodyHtml = `${CANVAS_SHELL}
<script type="application/vnd.rabbithole+mermaid" id="rabbithole-mermaid-runtime">${getMermaidScript()}</script>
${pdfRuntimeCarriers}
<script>
${getDompurifyScript()}
(function(){
	  "use strict";
	  var hydration = ${hydrationJson};
	${liveSnapshotSource}${clientSource}
	  RabbitholeClient.startRabbithole(hydration, {
	    snapshotHooks: {
	${liveSnapshotHoleHook}      getFrozenClientSource: function(){ return window.__RABBITHOLE_FROZEN_CLIENT__ || ""; },
	      getStylesheetText: function(){
	        var style = document.head && document.head.querySelector("style:first-of-type");
	        return style ? style.textContent : "";
	      }
	    }
	  });
	})();
</script>
`;
  return assembleRabbitholePage({ mode: "live", title, stylesheetText, bodyHtml });
}
