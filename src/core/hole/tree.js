/** @typedef {import("../contracts/engine.js").HoleNode} HoleNode */
/** @typedef {Map<string, HoleNode> | Record<string, HoleNode>} NodeCollection */

/** @param {NodeCollection} nodes @param {string | null} parentId */
export function childrenOf(nodes, parentId) {
  return [...valuesOfNodes(nodes)].filter((node) => (node.parent_id ?? null) === parentId);
}

/** @param {NodeCollection} nodes @param {string} rootId @returns {string[]} */
export function collectSubtreeIds(nodes, rootId) {
  const doomed = new Set();
  const children = new Map();
  for (const node of valuesOfNodes(nodes)) {
    if (!node.parent_id) continue;
    const siblings = children.get(node.parent_id);
    if (siblings) siblings.push(node.id);
    else children.set(node.parent_id, [node.id]);
  }
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop();
    if (!id || doomed.has(id)) continue;
    doomed.add(id);
    const descendants = children.get(id);
    if (descendants) pending.push(...descendants);
  }
  return [...doomed];
}

/** @param {NodeCollection} nodes @param {string} nodeId @returns {HoleNode[]} */
export function lineageNodesFromMap(nodes, nodeId) {
  /** @type {HoleNode[]} */
  const path = [];
  /** @type {HoleNode | null | undefined} */
  let current = getNode(nodes, nodeId);
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    path.push(current);
    current = current.parent_id ? getNode(nodes, current.parent_id) : null;
  }
  return path.reverse();
}

/** @param {NodeCollection} nodes @param {string} nodeId */
export function lineageTitlesFromMap(nodes, nodeId) {
  return lineageNodesFromMap(nodes, nodeId).map((node) => node.title || "Untitled");
}

/** @param {NodeCollection} nodes @param {string} id @returns {HoleNode | undefined} */
function getNode(nodes, id) {
  return /** @type {HoleNode | undefined} */ (nodes instanceof Map ? nodes.get(id) : nodes?.[id]);
}

/** @param {NodeCollection} nodes @returns {Iterable<HoleNode>} */
export function valuesOfNodes(nodes) {
  return nodes instanceof Map ? nodes.values() : Object.values(nodes || {});
}
