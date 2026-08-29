import checkCss from "../../../design/document/check.css";
import mermaidCss from "../../../design/document/mermaid.css";
import visualBaseCss from "../../../design/document/visual-base.css";
import { createRabbitholeUi } from "../../composition.js";
import { mountPdfView } from "../../pdf-view.js";
import { downloadSnapshot, resetSnapshotHooks, setSnapshotHooks } from "../../snapshot.js";
import {
  connectSse,
  deleteAsset,
  disposeTransportStatus,
  flushPendingSaves,
  initTransportStatus,
  persistNode,
  persistNodesBulk,
  post,
  putAsset,
  refreshStatus,
  scheduleViewSave,
  setTransportAdapter,
} from "../../transport-status.js";
import { setVisualStyles } from "../../visual-style-runtime.js";

export function startRabbithole(hydration, options) {
  setVisualStyles({ visualBaseCss, checkCss, mermaidCss });
  options = options || {};
  if (options.snapshotHooks) setSnapshotHooks(options.snapshotHooks);
  setTransportAdapter(options.transport);
  const runtime = createRabbitholeUi({
    hydration: hydration,
    host: {
      post: post,
      putAsset: putAsset,
      deleteAsset: deleteAsset,
      connect: connectSse,
      refreshStatus: refreshStatus,
      persistNode: persistNode,
      persistNodesBulk: persistNodesBulk,
      scheduleViewSave: scheduleViewSave,
      start: initTransportStatus,
      flush: flushPendingSaves,
      dispose: disposeTransportStatus,
    },
    capabilities: {
      mountPdfView: function (container, node) {
        return mountPdfView(container, node, { getTranscriptionCapability: options.getPdfTranscriptionCapability });
      },
      loadMermaid: options.loadMermaid || null,
      exportSnapshot: downloadSnapshot,
      exportPortable: options.exportPortable || null,
    },
  });
  const dispose = runtime.dispose;
  runtime.dispose = async function () {
    try {
      await dispose();
    } finally {
      resetSnapshotHooks();
    }
  };
  return runtime;
}
