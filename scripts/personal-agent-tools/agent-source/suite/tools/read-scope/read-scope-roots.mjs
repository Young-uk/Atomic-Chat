import { homedir } from "node:os";
import { resolve } from "node:path";
const QUOTED = /"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`/g;
const LEADING = /^[(\[{<]+/;
const TRAILING = /[.,;:!?)\]}>]+$/;
const DRIVE = /^[A-Za-z]:[\\/]/;
function looksLikeNamedPath(token) {
  if (token === "~" || token.startsWith("~/") || token.startsWith("~\\")) {
    return true;
  }
  if (DRIVE.test(token)) return true;
  return token.startsWith("/") && token.length > 1 && !token.startsWith("//");
}
function expandNamed(token, home) {
  if (token === "~") return home;
  if (token.startsWith("~/") || token.startsWith("~\\")) {
    return resolve(home, token.slice(2));
  }
  return DRIVE.test(token) ? token : resolve(token);
}
function pathsNamedIn(text, options = {}) {
  const home = options.home ?? homedir();
  const found = [];
  const add = (raw) => {
    const token = raw.replace(LEADING, "").replace(TRAILING, "");
    if (token.length === 0 || !looksLikeNamedPath(token)) return;
    const path = expandNamed(token, home);
    if (!found.includes(path)) found.push(path);
  };
  const rest = text.replace(
    QUOTED,
    (_match, a, b, c) => {
      const inner = (a ?? b ?? c ?? "").trim();
      if (looksLikeNamedPath(inner)) {
        add(inner);
        return " ";
      }
      return ` ${inner} `;
    }
  );
  for (const token of rest.split(/\s+/)) add(token);
  return found;
}
function userNamedPaths(turns, options = {}) {
  const found = [];
  for (const turn of turns) {
    if (turn.kind !== "user") continue;
    for (const path of pathsNamedIn(turn.text, options)) {
      if (!found.includes(path)) found.push(path);
    }
  }
  return found;
}
export {
  looksLikeNamedPath,
  pathsNamedIn,
  userNamedPaths
};
