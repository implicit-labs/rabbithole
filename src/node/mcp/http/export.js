import fs from "node:fs/promises";
import { extractNodeAssetRefs } from "../../../core/assets.js";
import { createSnapshotProjection } from "../../../core/snapshot-projection.js";
import { buildSnapshotHtml, snapshotProjectionUsesMermaid, snapshotProjectionUsesPdf } from "../../../core/snapshot-html.js";
import { toPersistedHole } from "../../../core/schema.js";
import { resolveAsset } from "../store/fs-store.js";
import { getDompurifyScript, getMermaidScript, getPdfJsScript, getPdfWorkerScript, getUiAssets } from "../../shared/dist-assets.js";

/** @param {import("../hole-session/session.js").RabbitholeSession} session */
async function buildSessionSnapshotProjection(session) {
  const hole = toPersistedHole(/** @type {any} */ (session.toHole()), { cloneExtensions: false });
  const referencedNames = new Set();
  for (const node of hole.nodes) {
    for (const name of extractNodeAssetRefs(node)) referencedNames.add(name);
  }
  const names = [...referencedNames].sort();
  const entries = new Array(names.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
    while (next < names.length) {
      const index = next++;
      const name = names[index];
      if (!session.assetNames.has(name)) { entries[index] = [name, ""]; continue; }
      try {
        const filePath = await resolveAsset(session.holeId, name);
        entries[index] = [name, filePath ? (await fs.readFile(filePath)).toString("base64") : ""];
      } catch { entries[index] = [name, ""]; }
    }
  }));
  const assets = Object.fromEntries(entries);
  return createSnapshotProjection(hole, /** @type {any} */ (session.viewState), assets);
}

/** @param {import("../hole-session/session.js").RabbitholeSession} session */
export async function buildSessionExportHtml(session) {
  const snapshotProjection = await buildSessionSnapshotProjection(session);
  const { stylesheetText, frozenClientSource } = await getUiAssets();
  return buildSnapshotHtml({
    title: snapshotProjection.hole.title || "Rabbithole",
    stylesheetText,
    dompurifySource: getDompurifyScript(),
    mermaidSource: snapshotProjectionUsesMermaid(snapshotProjection) ? getMermaidScript() : "",
    pdfWorkerSource: snapshotProjectionUsesPdf(snapshotProjection) ? getPdfWorkerScript() : "",
    pdfJsSource: snapshotProjectionUsesPdf(snapshotProjection) ? getPdfJsScript() : "",
    frozenClientSource,
    snapshotProjection,
  });
}
