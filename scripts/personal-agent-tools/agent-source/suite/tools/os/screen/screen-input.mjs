import { createHash } from "node:crypto";
import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import {
  requireApproval
} from "../../../approval/dangerous-tool.mjs";
import { toScreenPoint } from "./screen-geometry.mjs";
import {
  accessibilityMessage,
  macOnlyMessage,
  runScreenOp
} from "./screen-host.mjs";
import { parseKeyChord } from "./screen-keys.mjs";
import {
  protectedAppReason,
  protectedBundleIds,
  refusedChordReason,
  screenAppClass
} from "./screen-protected.mjs";
const OS_SCREEN_CLICK_TOOL = "os.screen.click";
const OS_SCREEN_TYPE_TOOL = "os.screen.type";
const OS_SCREEN_KEY_TOOL = "os.screen.key";
const SCREEN_TYPE_MAX_CHARS = 2e3;
const SCREEN_RESULT_OPTIONS = { maxSummaryLength: 1200, maxTailLines: 40 };
function buildInputTool(name, kind, description, options, plan) {
  const { deps } = options;
  return {
    name,
    description,
    readonly: false,
    async run(rawArgs, ctx) {
      if (deps.platform !== "darwin") {
        return result(name, "error", macOnlyMessage(name, deps.platform));
      }
      let action;
      let probe;
      try {
        action = plan(rawArgs, ctx);
        probe = await runScreenOp(deps, { op: "probe", ...action.point ? { point: action.point } : {} }, ctx);
        if (probe.accessibility === false) return permissionResult(name, deps);
        action.check?.(probe);
      } catch (error) {
        return result(name, "error", `${name}: ${error.message}`);
      }
      const target = action.point ? probe.ownerAtPoint ?? null : probe.frontmost;
      const refusal = protectedAppReason(target?.bundleId, deps.env, kind);
      if (refusal !== null || !target?.bundleId) {
        return refusedResult(
          name,
          `${action.summary} in ${describeApp(target)}`,
          refusal ?? "unknown target",
          { ...action.details, appClass: screenAppClass(target?.bundleId, deps.env) }
        );
      }
      const app = describeApp(target);
      const browserGuard = screenAppClass(target.bundleId, deps.env) === "browser";
      const ask = (signature) => requireApproval(
        browserGuard ? { ...options, approvalRequired: true } : options,
        {
          sessionId: ctx.sessionId,
          tool: name,
          category: "screen_control",
          reason: browserGuard ? `Confirm sensitive or unverified browser input in ${app}` : `${action.summary} in ${app}`,
          preview: [browserGuard && kind === "type" ? name : `${name}: ${action.summary}`, `receives the input: ${app}`, ...(browserGuard && kind === "type" ? ["Typed text is hidden from this preview."] : action.preview)].join("\n"),
          affectedResources: [`app:${target.bundleId}`, ...(signature ? [`screen-target:${createHash("sha256").update(signature).digest("hex")}`] : [])]
        },
        ctx.signal
      );
      if (!browserGuard) await ask();
      const pin = { expectBundleId: target.bundleId, protectedIds: protectedBundleIds(deps.env, kind), browserGuard };
      const run = (browserApproved) => runScreenOp(deps, action.operation({ ...pin, browserApproved }), ctx);
      let after;
      try {
        after = await run();
      } catch (error) {
        return result(name, "error", `${name}: ${error.message}`);
      }
      if (after.error === "browser-approval" && after.browserTarget) {
        await ask(after.browserTarget);
        try {
          after = await run(after.browserTarget);
        } catch (error) {
          return result(name, "error", `${name}: ${error.message}`);
        }
      }
      return actionResult(name, kind, app, action, after, deps);
    }
  };
}
function actionResult(name, kind, app, action, after, deps) {
  const details = { ...action.details, frontmost: after.frontmost, ...after.via ? { via: after.via } : {} };
  switch (after.error) {
    case void 0:
      break;
    case "accessibility":
      return permissionResult(name, deps);
    case "protected":
      return refusedResult(name, action.summary, `the input would reach ${describeApp(after.ownerAtPoint ?? after.frontmost)}, which screen control may not ${kind === "click" ? "click" : "type"} into`, details);
    case "not-frontmost":
      return result(name, "error", `${name} did nothing: ${app} could not be brought back to the front (now: ${describeApp(after.frontmost)}). Take a new os.screen.capture.`, { ...details, reason: "not-frontmost" });
    case "owner-mismatch":
      return result(name, "error", `${name} did nothing: the click would land on ${describeApp(after.ownerAtPoint ?? null)}, not the approved ${app}. Take a new os.screen.capture.`, { ...details, reason: "owner-mismatch" });
    default:
      return result(name, "error", `${name} did nothing: ${after.error}`, details);
  }
  if (!after.done) return result(name, "error", `${name} did nothing: the script reported no action`, details);
  return result(name, "ok", `${kind === "type" && screenAppClass(after.frontmost?.bundleId, deps.env) === "browser" ? "Typed text" : action.summary} in ${app}. Take os.screen.capture to see the result.`, details);
}
function buildOsScreenClickTool(options) {
  return buildInputTool(
    OS_SCREEN_CLICK_TOOL,
    "click",
    "Click on the primary display (macOS) at x,y in the pixels of the last os.screen.capture image. Browser actions ask for confirmation when sensitive or unverified. Never clicks the agent itself, settings or a password manager.",
    options,
    (args, ctx) => {
      const x = requireNumber(args.x, "x");
      const y = requireNumber(args.y, "y");
      const scale = args.scale === void 0 ? void 0 : requirePositive(args.scale, "scale");
      if (args.button !== void 0 && args.button !== "left" && args.button !== "right") {
        throw new Error('`button` must be "left" or "right"');
      }
      const button = args.button === "right" ? "right" : "left";
      const double = args.double === true;
      const point = toScreenPoint(x, y, options.geometry.get(ctx.sessionId), scale);
      const verb = `${double ? "double " : ""}${button} click`;
      return {
        point: { x: point.x, y: point.y },
        check: (probe) => {
          if (point.x < 0 || point.y < 0 || point.x > probe.screen.width || point.y > probe.screen.height) {
            throw new Error(
              `x,y ${x},${y} map to screen point ${point.x},${point.y}, outside the primary display (${probe.screen.width}x${probe.screen.height} points); take a new os.screen.capture`
            );
          }
        },
        operation: (pin) => ({ op: "click", x: point.x, y: point.y, button, double, ...pin }),
        summary: `${verb} at ${point.x},${point.y}`,
        preview: [`image px ${x},${y} at scale ${point.scale} \u2192 screen point ${point.x},${point.y}`],
        details: { x, y, screenX: point.x, screenY: point.y, scale: point.scale, button, double }
      };
    }
  );
}
function buildOsScreenTypeTool(options) {
  return buildInputTool(
    OS_SCREEN_TYPE_TOOL,
    "type",
    'Type text into the focused field of the frontmost app (macOS), as keystrokes or (via: "paste") through the clipboard. Browser actions ask for confirmation when sensitive or unverified. Never types into a terminal, code editor, the agent itself, settings or a password manager.',
    options,
    (args) => {
      const text = args.text;
      if (typeof text !== "string" || text.length === 0) {
        throw new Error("`text` must be a non-empty string");
      }
      if (text.length > SCREEN_TYPE_MAX_CHARS) {
        throw new Error(`\`text\` is ${text.length} characters; at most ${SCREEN_TYPE_MAX_CHARS} per call`);
      }
      if (args.via !== void 0 && args.via !== "keys" && args.via !== "paste") {
        throw new Error('`via` must be "keys" or "paste"');
      }
      const typeVia = args.via === "paste" ? "paste" : "keys";
      return {
        operation: (pin) => ({ op: "type", text, typeVia, ...pin }),
        summary: `type ${JSON.stringify(text)}`,
        preview: [previewText(text), ...typeVia === "paste" ? ["via the clipboard (restored afterwards)"] : []],
        details: { chars: text.length, typeVia }
      };
    }
  );
}
function buildOsScreenKeyTool(options) {
  return buildInputTool(
    OS_SCREEN_KEY_TOOL,
    "key",
    'Press a key or shortcut in the frontmost app (macOS), e.g. "return", "escape", "down", "cmd+l". Browser actions ask for confirmation when sensitive or unverified. Refused in terminals and code editors (use os.shell.run), and for app and space switchers (cmd+tab, ctrl+arrows, cmd+space).',
    options,
    (args) => {
      if (typeof args.keys !== "string") {
        throw new Error('`keys` must be a string such as "return" or "cmd+l"');
      }
      const chord = parseKeyChord(args.keys);
      const refused = refusedChordReason(chord);
      if (refused !== null) {
        throw new Error(`refused: ${refused}, which would move input to an app nobody approved; click the target instead`);
      }
      return {
        operation: (pin) => ({ op: "key", keyCode: chord.keyCode, flags: chord.flags, ...pin }),
        summary: `press ${chord.label}`,
        preview: [],
        details: { keys: chord.label, keyCode: chord.keyCode, flags: chord.flags }
      };
    }
  );
}
function previewText(text) {
  return `text (${text.length} chars): ${JSON.stringify(text)}`;
}
function describeApp(app) {
  if (!app || !app.name && !app.bundleId) return "an unknown app";
  if (app.name && app.bundleId) return `${app.name} (${app.bundleId})`;
  return app.name ?? app.bundleId ?? "an unknown app";
}
function requireNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`\`${field}\` must be a number >= 0`);
  }
  return value;
}
function requirePositive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`\`${field}\` must be a number > 0`);
  }
  return value;
}
function refusedResult(tool, what, why, details) {
  return result(
    tool,
    "error",
    `${tool} refused (${what}): ${why}. Screen control never clicks or types into Atomic Agent itself, system settings, the keychain or a password manager, and never types or presses keys in a terminal or code editor, at any approval level. Do not retry through screen control; use the tool named above, or tell the user to do this step themselves.`,
    { ...details, retryable: false, reason: "protected-app" }
  );
}
function permissionResult(tool, deps) {
  return result(tool, "error", accessibilityMessage(deps.env), {
    retryable: false,
    reason: "accessibility-permission"
  });
}
function result(tool, status, output, details = {}) {
  return compressToolResult({ tool, status, output, details }, SCREEN_RESULT_OPTIONS);
}
export {
  OS_SCREEN_CLICK_TOOL,
  OS_SCREEN_KEY_TOOL,
  OS_SCREEN_TYPE_TOOL,
  SCREEN_TYPE_MAX_CHARS,
  buildOsScreenClickTool,
  buildOsScreenKeyTool,
  buildOsScreenTypeTool,
  previewText
};
