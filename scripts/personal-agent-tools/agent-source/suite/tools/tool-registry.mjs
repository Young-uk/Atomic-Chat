import { statSync } from "node:fs";
import { fullToolResult } from "../compressor/result-compressor.mjs";
import { readArgumentAliases, withAliasNote } from "./argument-aliases.mjs";
import { coerceToolArgs } from "./coerce-tool-args.mjs";
import { resolveUserPath } from "./os/expand-home.mjs";
import { markUntrustedResult } from "./untrusted-tool-output.mjs";
import {
  maskErrorSecrets,
  maskResultSecrets,
  UNMASKED_TOOLS
} from "./tool-output-secrets.mjs";
import {
  knownSecretsFromEnv
} from "../error-reporting/secret-detector.mjs";
class ToolNotFoundError extends Error {
  constructor(name) {
    super(`tool not registered: ${name}`);
    this.name = "ToolNotFoundError";
  }
}
class ToolRegistry {
  tools = /* @__PURE__ */ new Map();
  outputSpill;
  knownSecrets;
  constructor(options = {}) {
    this.outputSpill = options.outputSpill;
    this.knownSecrets = options.knownSecrets ?? (() => knownSecretsFromEnv());
  }
  register(definition) {
    this.tools.set(definition.name, definition);
  }
  /**
   * Remove a tool by name. Returns `true` when a tool was actually
   * unregistered, `false` when the name was not known. Used by the
   * MCP manager to detach a server's tools cleanly on stop /
   * restart — the static native tools never call this.
   */
  unregister(name) {
    return this.tools.delete(name);
  }
  list() {
    return Array.from(this.tools.values());
  }
  has(name) {
    return this.tools.has(name);
  }
  get(name) {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotFoundError(name);
    return tool;
  }
  async invoke(name, args, ctx) {
    const tool = this.get(name);
    const aliased = readArgumentAliases(name, args, {
      isFile: (path) => isExistingFile(path, ctx.workingDir)
    });
    const masks = !UNMASKED_TOOLS.has(name);
    let result;
    try {
      result = await tool.run(coerceToolArgs(name, aliased?.args ?? args), ctx);
    } catch (err) {
      if (aliased !== null && err instanceof Error && !ctx.signal.aborted) {
        try {
          err.message = `${err.message}
${aliased.note}`;
        } catch {
        }
      }
      throw masks ? maskErrorSecrets(err, this.knownSecrets()) : err;
    }
    if (aliased !== null) result = withAliasNote(result, aliased.note);
    if (masks) result = maskResultSecrets(result, this.knownSecrets());
    const shown = ctx.modelMode === "cloud" ? fullToolResult(result) : this.outputSpill ? await this.outputSpill.spill(name, ctx.sessionId, result) : result;
    return tool.untrustedOutput === void 0 ? shown : markUntrustedResult(shown, tool.untrustedOutput);
  }
}
function isExistingFile(path, workingDir) {
  try {
    return statSync(resolveUserPath(path, workingDir)).isFile();
  } catch {
    return false;
  }
}
export {
  ToolNotFoundError,
  ToolRegistry
};
