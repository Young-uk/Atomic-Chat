import { globSync } from "node:fs";
import { isAbsolute } from "node:path";
import { basenameCommand } from "../shell-command-guard/normalise.mjs";
const MAX_GLOB_MATCHES = 1e4;
const SEGMENT_RE = /\s*(?:&&|\|\||;|\|)\s*/;
function isNode(token) {
  const bin = basenameCommand(token).toLowerCase().replace(/\.exe$/, "");
  return bin === "node" || bin === "nodejs";
}
function isCheckFlag(token) {
  return token === "--check" || token === "-c";
}
function unquote(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return token.slice(1, -1);
    }
  }
  return token;
}
function expand(pattern, cwd) {
  if (!/[*?]/.test(pattern)) return [pattern];
  try {
    const matches = globSync(pattern, {
      cwd: isAbsolute(pattern) ? void 0 : cwd
    }).slice(0, MAX_GLOB_MATCHES);
    return matches.length > 0 ? matches.sort() : [pattern];
  } catch {
    return [pattern];
  }
}
function nodeCheckPaths(commandLine, cwd) {
  for (const segment of commandLine.split(SEGMENT_RE)) {
    const tokens = segment.split(/\s+/).filter((t) => t.length > 0).map(unquote);
    if (tokens.length === 0 || !isNode(tokens[0])) continue;
    const flagIdx = tokens.findIndex((t, i) => i > 0 && isCheckFlag(t));
    if (flagIdx === -1) continue;
    const paths = [];
    for (const token of tokens.slice(flagIdx + 1)) {
      if (token.startsWith("-")) continue;
      paths.push(...expand(token, cwd));
    }
    return paths;
  }
  return null;
}
function nodeCheckMultiFileNotice(commandLine, cwd) {
  const paths = nodeCheckPaths(commandLine, cwd);
  if (paths === null || paths.length < 2) return null;
  return `node --check checks only the first file (${paths[0]}); run one command per file \u2014 the other ${paths.length - 1} path${paths.length === 2 ? " was" : "s were"} not checked`;
}
export {
  nodeCheckMultiFileNotice,
  nodeCheckPaths
};
