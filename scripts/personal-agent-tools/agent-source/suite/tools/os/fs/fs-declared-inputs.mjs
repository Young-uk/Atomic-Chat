import { isAbsolute } from "node:path";
class DeclaredInputsRegistry {
  bySession = /* @__PURE__ */ new Map();
  /** Declare `paths` (absolute, already resolved) for `sessionId`; replaces any earlier list. */
  declare(sessionId, paths) {
    const absolute = [...new Set(paths.filter((path) => isAbsolute(path)))];
    if (absolute.length === 0) {
      this.bySession.delete(sessionId);
      return;
    }
    this.bySession.set(sessionId, absolute);
  }
  /** Drop a session's list. Safe to call when nothing was declared. */
  clear(sessionId) {
    this.bySession.delete(sessionId);
  }
  /** The absolute paths declared for `sessionId`; empty when none. */
  inputsOf(sessionId) {
    return this.bySession.get(sessionId) ?? [];
  }
}
export {
  DeclaredInputsRegistry
};
