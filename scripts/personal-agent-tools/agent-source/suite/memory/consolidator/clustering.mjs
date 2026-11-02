function clusterEpisodes(candidates, opts, deps) {
  if (candidates.length === 0) return [];
  if (opts.maxClusters <= 0) return [];
  const minSize = Math.max(2, opts.minClusterSize);
  const idSet = /* @__PURE__ */ new Set();
  const byId = /* @__PURE__ */ new Map();
  for (const entry of candidates) {
    idSet.add(entry.id);
    byId.set(entry.id, entry);
  }
  const adjacency = /* @__PURE__ */ new Map();
  for (const id of idSet) adjacency.set(id, /* @__PURE__ */ new Set());
  for (const id of idSet) {
    const out = deps.linkStore.listOutgoing(id);
    for (const edge of out) {
      if (!idSet.has(edge.toId)) continue;
      adjacency.get(id).add(edge.toId);
      adjacency.get(edge.toId).add(id);
    }
    const inc = deps.linkStore.listIncoming(id);
    for (const edge of inc) {
      if (!idSet.has(edge.fromId)) continue;
      adjacency.get(id).add(edge.fromId);
      adjacency.get(edge.fromId).add(id);
    }
  }
  const visited = /* @__PURE__ */ new Set();
  const components = [];
  const seedOrder = [...idSet].sort((a, b) => a - b);
  for (const seed of seedOrder) {
    if (visited.has(seed)) continue;
    const component = bfsCc(seed, adjacency, visited);
    if (component.length < minSize) continue;
    if (!opts.requireSharedTag) {
      components.push({
        members: component.sort((a, b) => a - b),
        sharedTags: []
      });
      continue;
    }
    const trimmed = trimByMajorityTag(component, byId);
    if (trimmed.members.length < minSize) continue;
    components.push(trimmed);
  }
  components.sort((a, b) => a.members[0] - b.members[0]);
  return components.slice(0, opts.maxClusters);
}
function bfsCc(seed, adjacency, visited) {
  const queue = [seed];
  const result = [];
  visited.add(seed);
  while (queue.length > 0) {
    const node = queue.shift();
    result.push(node);
    const neighbours = adjacency.get(node);
    if (!neighbours) continue;
    for (const next of neighbours) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return result;
}
function trimByMajorityTag(ids, byId) {
  const counts = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) continue;
    for (const tag of entry.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return { members: [], sharedTags: [] };
  }
  let bestTag = "";
  let bestCount = 0;
  const sortedTags = [...counts.keys()].sort();
  for (const tag of sortedTags) {
    const c = counts.get(tag);
    if (c > bestCount) {
      bestTag = tag;
      bestCount = c;
    }
  }
  const filtered = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (entry.tags.includes(bestTag)) filtered.push(id);
  }
  filtered.sort((a, b) => a - b);
  return {
    members: filtered,
    sharedTags: bestTag.length > 0 ? [bestTag] : []
  };
}
export {
  clusterEpisodes
};
