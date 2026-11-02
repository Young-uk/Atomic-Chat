import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { listingResultCaps } from "../../../compressor/listing-caps.mjs";
import { runCommand } from "../../../sandbox/command-runner.mjs";
const DEFAULT_LIMIT = 500;
const ROW_CHARS = 340;
const osProcListTool = {
  name: "os.proc.list",
  description: "Snapshot the running processes. Returns PID/PPID/user/CPU%/MEM%/command per row. Args: `filter` (substring match on command, case-insensitive), `limit` (default 500).",
  readonly: true,
  async run(rawArgs, ctx) {
    const args = parseArgs(rawArgs);
    const rows = await collectProcessRows(ctx.signal);
    let filtered = rows;
    if (args.filter) {
      const needle = args.filter.toLowerCase();
      filtered = rows.filter((r) => r.command.toLowerCase().includes(needle));
    }
    const limited = filtered.slice(0, args.limit);
    return compressToolResult(
      {
        tool: "os.proc.list",
        status: "ok",
        output: formatTable(limited),
        details: {
          total: rows.length,
          matched: filtered.length,
          returned: limited.length,
          truncated: filtered.length > limited.length,
          processes: limited
        }
      },
      // `formatTable` puts the `PID PPID USER CPU% MEM% COMMAND`
      // header on line 1, so the default 12-line tail drops the column
      // header and leaves the last 12 of up to 500 rows — of which the
      // 385-char head-slice then keeps ~5. Budget the rows this call
      // actually returns — at most `limit`, which is DEFAULT_LIMIT
      // (500) unless the caller raised it — at ROW_CHARS each. This is
      // the one listing here that a default call can outgrow: 500 rows
      // ask for 170 KB and land on the shared ceiling, which measured
      // out at the header plus 40 real rows against the 2 rows the
      // compressor defaults left. A `filter` narrow enough to be
      // useful stays well under the ceiling and is not cut at all.
      listingResultCaps(limited.length, ROW_CHARS)
    );
  }
};
function parseArgs(raw) {
  const filter = typeof raw.filter === "string" && raw.filter.length > 0 ? raw.filter : void 0;
  let limit = DEFAULT_LIMIT;
  if (raw.limit !== void 0 && raw.limit !== null) {
    if (typeof raw.limit !== "number" || !Number.isFinite(raw.limit) || raw.limit <= 0) {
      throw new Error("os.proc.list: `limit` must be a positive number");
    }
    limit = Math.min(5e3, Math.floor(raw.limit));
  }
  return filter !== void 0 ? { filter, limit } : { limit };
}
async function collectProcessRows(signal) {
  if (process.platform === "win32") return collectWindows(signal);
  return collectPosix(signal);
}
async function collectPosix(signal) {
  const result = await runCommand(
    "ps",
    ["-eo", "pid=,ppid=,user=,pcpu=,pmem=,comm="],
    {
      cwd: process.cwd(),
      signal,
      timeoutMs: 15e3,
      maxOutputBytes: 4 * 1024 * 1024
    }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `os.proc.list: ps exited with ${result.exitCode}: ${result.stderr.trim()}`
    );
  }
  const rows = [];
  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/
    );
    if (!match) continue;
    const [, pid, ppid, user, pcpu, pmem, comm] = match;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      user,
      cpuPercent: Number(pcpu),
      memPercent: Number(pmem),
      command: comm
    });
  }
  return rows;
}
async function collectWindows(signal) {
  const result = await runCommand("tasklist", ["/FO", "CSV", "/NH"], {
    cwd: process.cwd(),
    signal,
    timeoutMs: 15e3,
    maxOutputBytes: 4 * 1024 * 1024
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `os.proc.list: tasklist exited with ${result.exitCode}: ${result.stderr.trim()}`
    );
  }
  const rows = [];
  for (const raw of result.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = parseCsvRow(line);
    if (fields.length < 2) continue;
    const pid = Number(fields[1]);
    if (!Number.isFinite(pid)) continue;
    rows.push({
      pid,
      ppid: null,
      user: "",
      cpuPercent: null,
      memPercent: null,
      command: fields[0] ?? ""
    });
  }
  return rows;
}
function parseCsvRow(line) {
  const out = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}
function formatTable(rows) {
  if (rows.length === 0) return "(no processes matched)";
  const header = "PID      PPID     USER               CPU%   MEM%   COMMAND";
  const lines = [header];
  for (const r of rows) {
    lines.push(
      `${String(r.pid).padEnd(8)} ${r.ppid === null ? "-" : String(r.ppid).padEnd(8)} ${(r.user || "-").padEnd(18)} ${formatPct(r.cpuPercent)} ${formatPct(r.memPercent)} ${r.command}`
    );
  }
  return lines.join("\n");
}
function formatPct(v) {
  if (v === null) return "-    ";
  return v.toFixed(1).padStart(5);
}
export {
  osProcListTool
};
