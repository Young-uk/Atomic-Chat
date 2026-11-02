import {
  parseGithubRemote,
  parseRepoSlug
} from "../../github/index.mjs";
import { runGit } from "../os/git/git-runner.mjs";
async function resolveRepo(raw, ctx, tool) {
  if (typeof raw === "string" && raw.trim().length > 0) {
    const ref2 = parseRepoSlug(raw);
    if (!ref2) {
      throw new Error(
        `${tool}: \`repo\` must be owner/name or a github.com URL, got ${JSON.stringify(raw)}`
      );
    }
    return ref2;
  }
  let url;
  try {
    const res = await runGit({
      workingDir: ctx.workingDir,
      // The push URL: a PR points at where the branch went, and a
      // `pushInsteadOf` rewrite can send pushes somewhere fetches do not go.
      args: ["remote", "get-url", "--push", "origin"],
      signal: ctx.signal,
      timeoutMs: 5e3
    });
    url = res.exitCode === 0 ? res.stdout.trim() : "";
  } catch {
    url = "";
  }
  if (!url) {
    throw new Error(
      `${tool}: no \`repo\` given and the working directory has no origin remote \u2014 pass \`repo: "owner/name"\``
    );
  }
  const ref = parseGithubRemote(url);
  if (!ref) {
    throw new Error(
      `${tool}: origin (${url}) is not on github.com \u2014 pass \`repo: "owner/name"\` explicitly`
    );
  }
  return ref;
}
async function currentBranch(ctx) {
  const res = await runGit({
    workingDir: ctx.workingDir,
    args: ["symbolic-ref", "--short", "-q", "HEAD"],
    signal: ctx.signal,
    timeoutMs: 5e3
  });
  const branch = res.stdout.trim();
  if (res.exitCode !== 0 || !branch) {
    throw new Error(
      "github.pr.create: could not read the current branch \u2014 pass `head` explicitly"
    );
  }
  return branch;
}
function requireString(raw, tool, field) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`${tool}: \`${field}\` must be a non-empty string`);
  }
  return raw.trim();
}
function optionalString(raw, tool, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string") {
    throw new Error(`${tool}: \`${field}\` must be a string`);
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function requireNumber(raw, tool, field) {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`${tool}: \`${field}\` must be a positive number`);
  }
  return Math.floor(raw);
}
function parseStringArray(raw, tool, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    throw new Error(`${tool}: \`${field}\` must be an array of strings`);
  }
  const values = raw.map((v) => v.trim()).filter((v) => v.length > 0);
  return values.length > 0 ? values : void 0;
}
function parseState(raw, tool) {
  if (raw === void 0 || raw === null) return "open";
  if (raw === "open" || raw === "closed" || raw === "all") return raw;
  throw new Error(`${tool}: \`state\` must be open, closed or all`);
}
function parseLimit(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 20;
  return Math.min(100, Math.floor(raw));
}
export {
  currentBranch,
  optionalString,
  parseLimit,
  parseState,
  parseStringArray,
  requireNumber,
  requireString,
  resolveRepo
};
