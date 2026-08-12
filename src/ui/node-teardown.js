import { disposeNodeContent, nodes, readerMain, unregisterNode } from "./core.js";
import { removeMarks } from "./text-marks.js";

/** @param {Record<string, any>} node */
export function detachNode(node) {
  if (!node) return;
  disposeNodeContent(node);
  if (node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
  node.el = null;
  node.bodyEl = null;
  node.titleEl = null;
  node.ncComp = null;
  node.ncInner = null;
  node.ncText = null;
  node.ncActions = null;
  node.ncHandle = null;
  node._noteEditor = null;
}

/** @param {string} id */
export function teardownNode(id) {
  var node = nodes[id];
  if (!node) return;
  detachNode(node);
  removeMarks(readerMain, id);
  var parent = nodes[node.parent_id];
  if (parent && parent.bodyEl) removeMarks(parent.bodyEl, id);
  unregisterNode(id);
}
