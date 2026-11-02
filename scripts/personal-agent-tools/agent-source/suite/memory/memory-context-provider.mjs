function createDefaultMemoryContextProvider(opts) {
  return {
    async buildMemoryContext(input) {
      const recalledBase = opts.recall.enabled ? await loadRecalled({
        store: opts.store,
        k: opts.recall.k,
        query: buildRecallQuery(input),
        workingDir: opts.workingDir
      }) : [];
      const recalled = expandWithLinks({
        store: opts.store,
        base: recalledBase,
        links: opts.links,
        metrics: opts.metrics
      });
      const recalledIds = new Set(recalled.map((e) => e.id));
      const index = opts.index.enabled ? loadIndex({
        store: opts.store,
        limit: opts.index.limit,
        previewChars: opts.index.previewChars,
        workingDir: opts.workingDir,
        excludeIds: recalledIds
      }) : [];
      const out = { recalled, index };
      if (opts.lessons && opts.lessons.enabled) {
        out.lessons = loadLessons({
          lessons: opts.lessons,
          query: buildRecallQuery(input)
        });
      }
      if (opts.procedures && opts.procedures.enabled) {
        out.procedures = loadProcedures({
          procedures: opts.procedures,
          query: buildRecallQuery(input)
        });
      }
      return out;
    }
  };
}
function loadProcedures(args) {
  const cfg = args.procedures;
  if (!cfg || !cfg.enabled || cfg.k <= 0) return [];
  const query = args.query.trim();
  if (query.length === 0) return [];
  try {
    const recallOpts = {
      query,
      k: cfg.k
    };
    if (typeof cfg.scoreBlend === "number") {
      recallOpts.scoreBlend = cfg.scoreBlend;
    }
    const hits = cfg.store.recall(recallOpts);
    return hits.map((p) => ({
      id: p.id,
      activation: p.activation,
      tags: p.tags,
      workingDir: p.workingDir,
      updatedAt: p.updatedAt
    }));
  } catch {
    return [];
  }
}
function loadLessons(args) {
  const cfg = args.lessons;
  if (!cfg || !cfg.enabled || cfg.k <= 0) return [];
  const query = args.query.trim();
  if (query.length === 0) return [];
  try {
    const hits = cfg.store.recall({ query, k: cfg.k });
    return hits.map((l) => ({
      id: l.id,
      activation: l.activation,
      tags: l.tags,
      workingDir: l.workingDir,
      updatedAt: l.updatedAt
    }));
  } catch {
    return [];
  }
}
async function loadRecalled(args) {
  if (args.k <= 0) return [];
  const query = args.query.trim();
  if (query.length === 0) return [];
  try {
    return await args.store.recallHybridAsync(query, {
      k: args.k,
      ...args.workingDir !== void 0 ? { scope: "project", workingDir: args.workingDir } : {}
    });
  } catch {
    return [];
  }
}
function buildRecallQuery(input) {
  const parts = [];
  const userMessage = (input.userMessage ?? "").trim();
  if (userMessage.length > 0) parts.push(userMessage);
  for (const summary of input.toolResultSummaries ?? []) {
    const normalized = summary.trim();
    if (normalized.length > 0) parts.push(normalized);
  }
  return parts.join("\n");
}
function expandWithLinks(args) {
  if (!args.links || !args.links.enabled || args.base.length === 0) {
    return args.base;
  }
  let expanded;
  try {
    expanded = args.links.store.expand(
      args.base.map((e) => e.id),
      {
        depth: args.links.depth,
        maxExpanded: args.links.maxExpanded
      }
    );
  } catch {
    return args.base;
  }
  if (expanded.length === 0) return args.base;
  const seen = new Set(args.base.map((e) => e.id));
  const hydrated = [];
  for (const id of expanded) {
    if (seen.has(id)) continue;
    const entry = args.store.get(id);
    if (!entry) continue;
    hydrated.push(entry);
    seen.add(id);
  }
  if (hydrated.length === 0) return args.base;
  args.metrics?.recordMemoryLinkExpansion({
    expanded: hydrated.length,
    depth: args.links.depth
  });
  return [...args.base, ...hydrated];
}
function loadIndex(args) {
  if (args.limit <= 0) return [];
  try {
    const overfetch = args.limit + args.excludeIds.size;
    const raw = args.store.listIndex({
      limit: overfetch,
      previewChars: args.previewChars,
      // Memory-v2 phase 5. Archived parents (`consolidated_into IS
      // NOT NULL`) must drop out of the hot index — their content
      // is now distilled into a lesson. They remain readable by id
      // via `memory.notes.recall { id }` (cross-phase invariant 9).
      excludeArchived: true,
      ...args.workingDir !== void 0 ? { scope: "project", workingDir: args.workingDir } : {}
    });
    const filtered = raw.filter((row) => !args.excludeIds.has(row.id));
    return filtered.slice(0, args.limit);
  } catch {
    return [];
  }
}
export {
  createDefaultMemoryContextProvider
};
