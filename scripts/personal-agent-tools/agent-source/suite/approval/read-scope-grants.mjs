import { isAbsolute, resolve } from "node:path";
import { isInside } from "./fanout-scope.mjs";
class ReadScopeGrants {
  rootsBySession = /* @__PURE__ */ new Map();
  /**
   * Remember that `sessionId` may read under `dir`. A directory already
   * covered by an earlier root is a no-op; a root the new one covers is
   * folded into it, so the list stays a set of disjoint roots.
   */
  widen(sessionId, dir) {
    if (!isAbsolute(dir)) return;
    const root = resolve(dir);
    const roots = this.rootsBySession.get(sessionId) ?? [];
    if (roots.some((known) => isInside(known, root))) return;
    this.rootsBySession.set(sessionId, [
      ...roots.filter((known) => !isInside(root, known)),
      root
    ]);
  }
  /** The directories `sessionId` was granted, in the order they were. */
  rootsFor(sessionId) {
    return this.rootsBySession.get(sessionId) ?? [];
  }
  /**
   * Drop a session's roots — or every session's, with no argument — the
   * same two forms `ApprovalGate.clearSessionGrants` takes.
   */
  clear(sessionId) {
    if (sessionId === void 0) {
      this.rootsBySession.clear();
      return;
    }
    this.rootsBySession.delete(sessionId);
  }
}
export {
  ReadScopeGrants
};
