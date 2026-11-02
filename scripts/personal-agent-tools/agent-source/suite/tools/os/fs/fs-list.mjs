import { OS_FS_LIST_CONTRACT, DEFAULT_MAX_ENTRIES, normaliseExt, parseListArgs as parseArgs } from "./fs-list-contract.mjs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { orMissing } from "./fs-missing-path.mjs";
const TOP_EXTENSIONS_IN_HEADER = 5;
const LISTING_MAX_CHARS = 6e3;
const LISTING_MAX_ROWS = DEFAULT_MAX_ENTRIES;
const LISTING_MAX_LINES = 6 + LISTING_MAX_ROWS + 1;
const osFsListTool = {
  name: OS_FS_LIST_CONTRACT.name,
  description: OS_FS_LIST_CONTRACT.description,
  readonly: OS_FS_LIST_CONTRACT.readonly,
  async run(rawArgs, ctx) {
    const args = parseArgs(rawArgs);
    const absolute = resolveUserPath(args.path, ctx.workingDir);
    const names = await orMissing(
      "os.fs.list",
      absolute,
      ctx,
      () => readdirOrRefuseFile(absolute)
    );
    if ("missing" in names) return names.missing;
    const entries = await statEntries(absolute, names);
    const matched = entries.filter((e) => entryMatches(e, args));
    const sorted = sortEntries(matched, args.sort);
    const shown = sorted.slice(0, args.maxEntries);
    const output = renderOutput(absolute, entries, matched, shown, args);
    return compressToolResult(
      {
        tool: "os.fs.list",
        status: "ok",
        output,
        details: {
          path: absolute,
          total: entries.length,
          matched: matched.length,
          shown: shown.length,
          filter: {
            pattern: args.pattern,
            kind: args.kind,
            extensions: args.extensions
          },
          sort: args.sort,
          entries: shown.map((e) => ({
            name: e.name,
            kind: e.kind,
            size: e.size,
            mtimeMs: e.mtimeMs
          }))
        }
      },
      // `renderOutput` has already clipped the rows to these bounds and
      // named what it hid; passing them on keeps the compressor from
      // cutting a second time and losing either the header or that line.
      { maxSummaryLength: LISTING_MAX_CHARS, maxTailLines: LISTING_MAX_LINES }
    );
  }
};
async function statEntries(absolute, names) {
  const rows = [];
  for (const name of names) {
    try {
      const info = await stat(join(absolute, name));
      const kind = info.isFile() ? "file" : info.isDirectory() ? "dir" : "other";
      rows.push({ name, kind, size: info.size, mtimeMs: info.mtimeMs });
    } catch {
      rows.push({ name, kind: "other", size: 0, mtimeMs: 0 });
    }
  }
  return rows;
}
function entryMatches(e, args) {
  if (args.kind && e.kind !== args.kind) return false;
  if (args.extensions) {
    if (e.kind !== "file") return false;
    const ext = normaliseExt(extname(e.name));
    if (!args.extensions.includes(ext)) return false;
  }
  if (args.patternRegex && !args.patternRegex.test(e.name)) return false;
  return true;
}
function sortEntries(rows, sort) {
  const copy = [...rows];
  if (sort === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === "size") {
    copy.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  }
  return copy;
}
function renderOutput(absolute, all, matched, shown, args) {
  const fileCount = all.filter((e) => e.kind === "file").length;
  const dirCount = all.filter((e) => e.kind === "dir").length;
  const otherCount = all.length - fileCount - dirCount;
  const header = [];
  header.push(`path: ${absolute}`);
  header.push(
    `total: ${all.length} entries (file=${fileCount}, dir=${dirCount}` + (otherCount > 0 ? `, other=${otherCount}` : ``) + `)`
  );
  const filterParts = describeFilter(args);
  if (filterParts.length > 0) {
    header.push(
      `filter: ${filterParts.join(", ")} \u2192 matched=${matched.length}`
    );
  }
  const topExt = topExtensions(all, TOP_EXTENSIONS_IN_HEADER);
  if (topExt.length > 0) {
    header.push(`top extensions: ${topExt.join(", ")}`);
  }
  header.push(`sort: ${args.sort}${args.sort === "name" ? " asc" : " desc"}`);
  const shownLabel = matched.length === 0 ? `(no matches)` : shown.length === matched.length ? `[showing ${shown.length}/${matched.length}]` : `[showing ${shown.length}/${matched.length}; refine with pattern= or extensions= to narrow]`;
  const head = [header.join("\n"), shownLabel].join("\n");
  if (shown.length === 0) return head;
  return [
    head,
    clipRows(
      shown.map((e) => formatRow(e, args.sort)),
      head
    )
  ].join("\n");
}
function clipRows(rows, head) {
  const budget = LISTING_MAX_CHARS - head.length - hiddenRowsNote(rows.length).length - 2;
  let kept = 0;
  let chars = 0;
  while (kept < rows.length && kept < LISTING_MAX_ROWS) {
    const next = chars + (kept > 0 ? 1 : 0) + rows[kept].length;
    if (next > budget) break;
    chars = next;
    kept += 1;
  }
  if (kept >= rows.length) return rows.join("\n");
  const shown = Math.max(1, kept);
  return [...rows.slice(0, shown), hiddenRowsNote(rows.length - shown)].join(
    "\n"
  );
}
function hiddenRowsNote(hidden) {
  return `\u2026 ${hidden} more ${hidden === 1 ? "entry" : "entries"} not shown; narrow with pattern= or extensions=`;
}
function describeFilter(args) {
  const parts = [];
  if (args.pattern) parts.push(`pattern=${JSON.stringify(args.pattern)}`);
  if (args.kind) parts.push(`kind=${args.kind}`);
  if (args.extensions) parts.push(`extensions=[${args.extensions.join(",")}]`);
  return parts;
}
function formatRow(e, sort) {
  const kind = e.kind.padEnd(4);
  const size = e.size.toString().padStart(10);
  if (sort === "mtime" && e.mtimeMs > 0) {
    const date = new Date(e.mtimeMs).toISOString().slice(0, 10);
    return `${kind} ${size}  ${date}  ${e.name}`;
  }
  return `${kind} ${size}  ${e.name}`;
}
function topExtensions(all, limit) {
  const counts = /* @__PURE__ */ new Map();
  for (const e of all) {
    if (e.kind !== "file") continue;
    const ext = normaliseExt(extname(e.name)) || "(no ext)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([ext, n]) => `${ext}=${n}`);
}
async function readdirOrRefuseFile(absolute) {
  try {
    return await readdir(absolute);
  } catch (err) {
    if (err.code !== "ENOTDIR") throw err;
    const info = await stat(absolute).catch(() => null);
    if (info === null) throw err;
    throw new Error(
      `os.fs.list: ${absolute} is a file, not a folder. Read it with os.fs.read, or list its folder.`,
      { cause: err }
    );
  }
}
export {
  osFsListTool
};
