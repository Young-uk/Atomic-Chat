import { isAbsolute, relative, resolve } from "node:path";
class FanoutScopeRegistry {
  dirsBySession = /* @__PURE__ */ new Map();
  turnScopeBySession = /* @__PURE__ */ new Map();
  /**
   * Authorise `dirs` (absolute, already resolved) for `sessionId`.
   * Replaces any previous grant: a session runs one fan-out task.
   */
  grant(sessionId, dirs) {
    const absolute = dirs.filter((dir) => isAbsolute(dir));
    if (absolute.length === 0) {
      this.dirsBySession.delete(sessionId);
      return;
    }
    this.dirsBySession.set(sessionId, absolute);
  }
  /** Drop a session's scope. Safe to call when nothing was granted. */
  clear(sessionId) {
    this.dirsBySession.delete(sessionId);
  }
  /**
   * Whether every one of `paths` sits inside a granted directory.
   *
   * All or nothing on purpose: a call that writes three files, one of
   * them outside the scope, is not a call the operator authorised. It
   * goes to the gate, where the refuse policy turns it into a task the
   * orchestrator must re-delegate.
   */
  allows(sessionId, paths) {
    const dirs = this.dirsBySession.get(sessionId);
    if (dirs === void 0 || paths.length === 0) return false;
    return paths.every(
      (path) => dirs.some((dir) => isInside(dir, resolve(path)))
    );
  }
  /** The granted directories, for a prompt or a diagnostic. */
  scopeFor(sessionId) {
    return this.dirsBySession.get(sessionId) ?? [];
  }
  /**
   * Remember what this turn's operator already authorised, so the next
   * fan-out of the same turn does not ask again.
   */
  grantForTurn(sessionId, dirs) {
    const absolute = dirs.filter((dir) => isAbsolute(dir));
    if (absolute.length === 0) return;
    const merged = /* @__PURE__ */ new Set([
      ...this.turnScopeBySession.get(sessionId) ?? [],
      ...absolute
    ]);
    this.turnScopeBySession.set(sessionId, [...merged]);
  }
  /**
   * Whether this turn's standing answer already covers `dirs`.
   *
   * Containment, not equality: a later fan-out writing deeper inside an
   * approved directory is the same permission. One reaching outside it
   * is a new question, and gets asked.
   */
  turnGrantCovers(sessionId, dirs) {
    const approved = this.turnScopeBySession.get(sessionId);
    if (approved === void 0 || dirs.length === 0) return false;
    return dirs.every(
      (dir) => approved.some((root) => isInside(root, resolve(dir)))
    );
  }
  /**
   * Forget a turn's standing answer. Called when a turn starts, so the
   * authority never outlives the job it was given for.
   */
  clearTurnGrant(sessionId) {
    this.turnScopeBySession.delete(sessionId);
  }
}
function isInside(parent, child) {
  const rel = relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}
export {
  FanoutScopeRegistry,
  isInside
};
