import { mkdir, stat } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { runCommand } from "../../../sandbox/command-runner.mjs";
import { buildScreenInvocation } from "./screen-jxa.mjs";
const defaultScreenRunner = (command, args, options) => runCommand(command, [...args], {
  cwd: options.cwd,
  signal: options.signal,
  timeoutMs: options.timeoutMs,
  ...options.env === void 0 ? {} : { env: options.env }
});
function resolveScreenDeps(overrides = {}) {
  return {
    run: overrides.run ?? defaultScreenRunner,
    platform: overrides.platform ?? platform(),
    env: overrides.env ?? process.env,
    fileSize: overrides.fileSize ?? (async (path) => (await stat(path)).size),
    ensureDir: overrides.ensureDir ?? (async (path) => {
      await mkdir(path, { recursive: true });
    }),
    now: overrides.now ?? (() => /* @__PURE__ */ new Date()),
    tmpDir: overrides.tmpDir ?? tmpdir()
  };
}
const SCREEN_JXA_TIMEOUT_MS = 15e3;
async function runScreenOp(deps, operation, ctx) {
  const call = buildScreenInvocation(operation, deps.env);
  const result = await deps.run(call.command, call.args, {
    cwd: ctx.workingDir,
    signal: ctx.signal,
    timeoutMs: SCREEN_JXA_TIMEOUT_MS,
    env: call.env
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `osascript failed (exit ${result.exitCode ?? "none"}): ${result.stderr.trim() || "no output"}`
    );
  }
  return parseScreenProbe(result.stdout);
}
function parseScreenProbe(stdout) {
  let raw;
  try {
    raw = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`unexpected osascript output: ${stdout.trim().slice(0, 200)}`);
  }
  const obj = raw ?? {};
  const screen = obj.screen ?? {};
  const width = Number(screen.width);
  const height = Number(screen.height);
  const scale = Number(screen.scale);
  if (!(width > 0) || !(height > 0)) {
    throw new Error("osascript reported no primary display");
  }
  return {
    accessibility: typeof obj.accessibility === "boolean" ? obj.accessibility : null,
    screenRecording: typeof obj.screenRecording === "boolean" ? obj.screenRecording : null,
    frontmost: parseApp(obj.frontmost),
    ..."ownerAtPoint" in obj ? { ownerAtPoint: parseApp(obj.ownerAtPoint) } : {},
    screen: { width, height, scale: scale > 0 ? scale : 1 },
    done: obj.done === true,
    ...(typeof obj.browserTarget === "string" ? { browserTarget: obj.browserTarget } : {}),
    ...typeof obj.via === "string" ? { via: obj.via } : {},
    ...typeof obj.error === "string" ? { error: obj.error } : {}
  };
}
function parseApp(raw) {
  if (!raw || typeof raw !== "object") return null;
  const app = raw;
  return {
    name: typeof app.name === "string" ? app.name : null,
    bundleId: typeof app.bundleId === "string" ? app.bundleId : null
  };
}
const TERM_PROGRAM_NAMES = {
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm",
  vscode: "Visual Studio Code",
  WarpTerminal: "Warp",
  ghostty: "Ghostty",
  WezTerm: "WezTerm"
};
function hostAppName(env) {
  const term = env.TERM_PROGRAM;
  if (term && TERM_PROGRAM_NAMES[term]) return TERM_PROGRAM_NAMES[term];
  if (term) return term;
  const bundle = env.__CFBundleIdentifier;
  if (bundle) return bundle;
  return "the app that runs Atomic Agent (your terminal or Atomic Agent Desktop)";
}
function accessibilityMessage(env) {
  const host = hostAppName(env);
  return `macOS has not given ${host} Accessibility permission, so the agent cannot click or type. Ask the user to open System Settings \u2192 Privacy & Security \u2192 Accessibility, turn on ${host}, and restart it. Nothing was clicked or typed. Do not retry until the user says it is done.`;
}
function screenRecordingMessage(env) {
  const host = hostAppName(env);
  return `macOS has not given ${host} Screen Recording permission (or the capture came back empty), so the screenshot would show no windows. Ask the user to open System Settings \u2192 Privacy & Security \u2192 Screen & System Audio Recording (Screen Recording on older macOS), turn on ${host}, and restart it. Do not retry until the user says it is done.`;
}
function macOnlyMessage(tool, os) {
  return `${tool} works on macOS only (this is ${os}); Windows and Linux support is tracked in ATO-527.`;
}
export {
  SCREEN_JXA_TIMEOUT_MS,
  accessibilityMessage,
  defaultScreenRunner,
  hostAppName,
  macOnlyMessage,
  parseScreenProbe,
  resolveScreenDeps,
  runScreenOp,
  screenRecordingMessage
};
