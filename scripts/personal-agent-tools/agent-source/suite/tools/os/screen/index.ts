import type { ToolRegistry } from "../../tool-registry.mjs";
import type { DangerousToolOptions } from "../../../approval/dangerous-tool.mjs";
import { buildOsScreenCaptureTool } from "./screen-capture.mjs";
import {
  buildOsScreenClickTool,
  buildOsScreenKeyTool,
  buildOsScreenTypeTool,
} from "./screen-input.mjs";
import { ScreenGeometryStore } from "./screen-geometry.mjs";
import { resolveScreenDeps, type ScreenDeps } from "./screen-host.mjs";

export {
  buildOsScreenCaptureTool,
  OS_SCREEN_CAPTURE_TOOL,
  SCREENSHOT_DIR,
  parseRegion,
  screencaptureArgs,
  screenshotDir,
} from "./screen-capture.mjs";
export type { OsScreenCaptureOptions, ScreenRegion } from "./screen-capture.mjs";
export {
  buildOsScreenClickTool,
  buildOsScreenKeyTool,
  buildOsScreenTypeTool,
  OS_SCREEN_CLICK_TOOL,
  OS_SCREEN_KEY_TOOL,
  OS_SCREEN_TYPE_TOOL,
  previewText,
  SCREEN_TYPE_MAX_CHARS,
} from "./screen-input.mjs";
export type { OsScreenInputOptions } from "./screen-input.mjs";
export {
  captureGeometry,
  fitWithin,
  ScreenGeometryStore,
  SCREENSHOT_MAX_SIDE,
  toScreenPoint,
} from "./screen-geometry.mjs";
export type { CaptureGeometry } from "./screen-geometry.mjs";
export { parseKeyChord } from "./screen-keys.mjs";
export type { KeyChord } from "./screen-keys.mjs";
export {
  accessibilityMessage,
  hostAppName,
  parseScreenProbe,
  resolveScreenDeps,
  screenRecordingMessage,
} from "./screen-host.mjs";
export type {
  ScreenApp,
  ScreenCommandResult,
  ScreenDeps,
  ScreenProbe,
  ScreenRunner,
} from "./screen-host.mjs";
export { buildScreenInvocation, SCREEN_PAYLOAD_ENV, screenChildEnv } from "./screen-jxa.mjs";
export {
  BLOCKED_BUNDLE_IDS,
  BROWSER_BUNDLE_IDS,
  hostBundleIds,
  protectedAppReason,
  protectedBundleIds,
  refusedChordReason,
  screenAppClass,
  TERMINAL_BUNDLE_IDS,
} from "./screen-protected.mjs";
export type { ScreenAppClass, ScreenInputKind } from "./screen-protected.mjs";
export type { ScreenOp } from "./screen-jxa.mjs";

/** The four names, in catalog order — mirrored by `GATED_TOOLS.screen`. */
export const OS_SCREEN_TOOL_NAMES = [
  "os.screen.capture",
  "os.screen.click",
  "os.screen.type",
  "os.screen.key",
] as const;

export interface RegisterOsScreenToolsOptions extends DangerousToolOptions {
  /** `tools.screen.enabled` — computer use is opt-in, default off. */
  enabled: boolean;
  /** Host platform; the tools exist on macOS only (other OSes: ATO-527). */
  platform?: NodeJS.Platform;
  /** Test seam: runner, clock and file helpers. */
  deps?: Partial<ScreenDeps>;
}

/**
 * Register `os.screen.{capture,click,type,key}` when the operator turned
 * them on and the host is macOS; otherwise register nothing (the
 * descriptor gate drops them from the prompt the same way). The four
 * share one geometry store, so a click maps the pixels of the capture
 * the same session took last.
 */
export function registerOsScreenTools(
  registry: ToolRegistry,
  options: RegisterOsScreenToolsOptions,
): void {
  if (!options.enabled) return;
  const deps = resolveScreenDeps({
    ...options.deps,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  });
  if (deps.platform !== "darwin") return;
  const geometry = new ScreenGeometryStore();
  const input = {
    approvals: options.approvals,
    approvalRequired: options.approvalRequired,
    deps,
    geometry,
  };
  registry.register(buildOsScreenCaptureTool(input));
  registry.register(buildOsScreenClickTool(input));
  registry.register(buildOsScreenTypeTool(input));
  registry.register(buildOsScreenKeyTool(input));
}
