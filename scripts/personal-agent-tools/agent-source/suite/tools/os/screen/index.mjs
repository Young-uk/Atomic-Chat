import { buildOsScreenCaptureTool } from "./screen-capture.mjs";
import {
  buildOsScreenClickTool,
  buildOsScreenKeyTool,
  buildOsScreenTypeTool
} from "./screen-input.mjs";
import { ScreenGeometryStore } from "./screen-geometry.mjs";
import { resolveScreenDeps } from "./screen-host.mjs";
import {
  buildOsScreenCaptureTool as buildOsScreenCaptureTool2,
  OS_SCREEN_CAPTURE_TOOL,
  SCREENSHOT_DIR,
  parseRegion,
  screencaptureArgs,
  screenshotDir
} from "./screen-capture.mjs";
import {
  buildOsScreenClickTool as buildOsScreenClickTool2,
  buildOsScreenKeyTool as buildOsScreenKeyTool2,
  buildOsScreenTypeTool as buildOsScreenTypeTool2,
  OS_SCREEN_CLICK_TOOL,
  OS_SCREEN_KEY_TOOL,
  OS_SCREEN_TYPE_TOOL,
  previewText,
  SCREEN_TYPE_MAX_CHARS
} from "./screen-input.mjs";
import {
  captureGeometry,
  fitWithin,
  ScreenGeometryStore as ScreenGeometryStore2,
  SCREENSHOT_MAX_SIDE,
  toScreenPoint
} from "./screen-geometry.mjs";
import { parseKeyChord } from "./screen-keys.mjs";
import {
  accessibilityMessage,
  hostAppName,
  parseScreenProbe,
  resolveScreenDeps as resolveScreenDeps2,
  screenRecordingMessage
} from "./screen-host.mjs";
import { buildScreenInvocation, SCREEN_PAYLOAD_ENV, screenChildEnv } from "./screen-jxa.mjs";
import {
  BLOCKED_BUNDLE_IDS,
  BROWSER_BUNDLE_IDS,
  hostBundleIds,
  protectedAppReason,
  protectedBundleIds,
  refusedChordReason,
  screenAppClass,
  TERMINAL_BUNDLE_IDS
} from "./screen-protected.mjs";
const OS_SCREEN_TOOL_NAMES = [
  "os.screen.capture",
  "os.screen.click",
  "os.screen.type",
  "os.screen.key"
];
function registerOsScreenTools(registry, options) {
  if (!options.enabled) return;
  const deps = resolveScreenDeps({
    ...options.deps,
    ...options.platform === void 0 ? {} : { platform: options.platform }
  });
  if (deps.platform !== "darwin") return;
  const geometry = new ScreenGeometryStore();
  const input = {
    approvals: options.approvals,
    approvalRequired: options.approvalRequired,
    deps,
    geometry
  };
  registry.register(buildOsScreenCaptureTool(input));
  registry.register(buildOsScreenClickTool(input));
  registry.register(buildOsScreenTypeTool(input));
  registry.register(buildOsScreenKeyTool(input));
}
export {
  BLOCKED_BUNDLE_IDS,
  BROWSER_BUNDLE_IDS,
  OS_SCREEN_CAPTURE_TOOL,
  OS_SCREEN_CLICK_TOOL,
  OS_SCREEN_KEY_TOOL,
  OS_SCREEN_TOOL_NAMES,
  OS_SCREEN_TYPE_TOOL,
  SCREENSHOT_DIR,
  SCREENSHOT_MAX_SIDE,
  SCREEN_PAYLOAD_ENV,
  SCREEN_TYPE_MAX_CHARS,
  ScreenGeometryStore2 as ScreenGeometryStore,
  TERMINAL_BUNDLE_IDS,
  accessibilityMessage,
  buildOsScreenCaptureTool2 as buildOsScreenCaptureTool,
  buildOsScreenClickTool2 as buildOsScreenClickTool,
  buildOsScreenKeyTool2 as buildOsScreenKeyTool,
  buildOsScreenTypeTool2 as buildOsScreenTypeTool,
  buildScreenInvocation,
  captureGeometry,
  fitWithin,
  hostAppName,
  hostBundleIds,
  parseKeyChord,
  parseRegion,
  parseScreenProbe,
  previewText,
  protectedAppReason,
  protectedBundleIds,
  refusedChordReason,
  registerOsScreenTools,
  resolveScreenDeps2 as resolveScreenDeps,
  screenAppClass,
  screenChildEnv,
  screenRecordingMessage,
  screencaptureArgs,
  screenshotDir,
  toScreenPoint
};
