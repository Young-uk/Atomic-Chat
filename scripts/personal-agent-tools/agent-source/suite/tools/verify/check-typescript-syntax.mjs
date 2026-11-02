import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { runChecker } from "./check-script-syntax.mjs";
import { tailOfOutput } from "./syntax-check-types.mjs";
const TS_CHECKER = "tsc --noEmit";
const TSC_TIMEOUT_MS = 3e5;
function findTsconfig(dir) {
  let current = resolve(dir);
  for (; ; ) {
    const candidate = join(current, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function findTscBinary(dir) {
  const name = process.platform === "win32" ? "tsc.cmd" : "tsc";
  let current = resolve(dir);
  for (; ; ) {
    const candidate = join(current, "node_modules", ".bin", name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/;
async function checkProject(tsconfig, tsc) {
  const projectDir = dirname(tsconfig);
  const buildInfo = join(tmpdir(), `atag-verify-${randomBytes(4).toString("hex")}.tsbuildinfo`);
  const run = await runChecker(
    tsc,
    ["--noEmit", "-p", tsconfig, "--pretty", "false", "--listFiles", "--incremental", "--tsBuildInfoFile", buildInfo],
    { cwd: projectDir, timeoutMs: TSC_TIMEOUT_MS }
  );
  await rm(buildInfo, { force: true });
  if (run.missing) {
    return { ok: false, diagnostics: /* @__PURE__ */ new Map(), included: /* @__PURE__ */ new Set(), errorCount: 0, failure: "tsc could not be started" };
  }
  if (run.timedOut) {
    return { ok: false, diagnostics: /* @__PURE__ */ new Map(), included: /* @__PURE__ */ new Set(), errorCount: 0, failure: "tsc timed out" };
  }
  const diagnostics = /* @__PURE__ */ new Map();
  const included = /* @__PURE__ */ new Set();
  let errorCount = 0;
  for (const raw of run.stdout.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const match = line.match(DIAGNOSTIC);
    if (match) {
      const path = resolve(projectDir, match[1]);
      errorCount += 1;
      const list = diagnostics.get(path) ?? [];
      list.push(`line ${match[2]}: ${match[4]}`);
      diagnostics.set(path, list);
      continue;
    }
    if (isAbsolute(line) && !line.includes(": ")) included.add(resolve(line));
  }
  if (run.exitCode !== 0 && errorCount === 0) {
    return {
      ok: false,
      diagnostics,
      included,
      errorCount,
      failure: tailOfOutput(`${run.stdout}
${run.stderr}`, 4) || `tsc exited ${run.exitCode}`
    };
  }
  return { ok: run.exitCode === 0, diagnostics, included, errorCount, failure: null };
}
function withoutVerdict(file, error) {
  return { file, ok: null, checker: "none", error };
}
async function checkTypeScriptFiles(files) {
  const byProject = /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  for (const entry of files) {
    const tsconfig = findTsconfig(dirname(entry.absolute));
    if (tsconfig === null) {
      results.set(entry.absolute, withoutVerdict(entry.file, "no tsconfig.json above the file"));
      continue;
    }
    const group = byProject.get(tsconfig) ?? [];
    group.push(entry);
    byProject.set(tsconfig, group);
  }
  for (const [tsconfig, group] of byProject) {
    const projectDir = dirname(tsconfig);
    const tsc = findTscBinary(projectDir);
    if (tsc === null) {
      for (const entry of group) {
        results.set(entry.absolute, withoutVerdict(entry.file, `no node_modules/.bin/tsc above ${projectDir}`));
      }
      continue;
    }
    const project = await checkProject(tsconfig, tsc);
    for (const entry of group) {
      results.set(entry.absolute, attribute(entry, project, tsconfig));
    }
  }
  return files.map((entry) => results.get(entry.absolute));
}
function attribute(entry, project, tsconfig) {
  const { file, absolute } = entry;
  if (project.failure !== null) {
    return { file, ok: null, checker: TS_CHECKER, error: project.failure };
  }
  const own = project.diagnostics.get(absolute);
  if (own !== void 0) {
    const shown = own.slice(0, 3).join("; ");
    const more = own.length > 3 ? ` (+${own.length - 3} more)` : "";
    return { file, ok: false, checker: TS_CHECKER, error: `${shown}${more}` };
  }
  if (!project.included.has(absolute)) {
    return withoutVerdict(file, `not included by ${tsconfig}`);
  }
  if (project.errorCount > 0) {
    return {
      file,
      ok: true,
      checker: TS_CHECKER,
      warning: `tsc reported ${project.errorCount} error(s) in other files of ${dirname(tsconfig)}`
    };
  }
  return { file, ok: true, checker: TS_CHECKER };
}
export {
  TS_CHECKER,
  checkTypeScriptFiles,
  findTscBinary,
  findTsconfig
};
