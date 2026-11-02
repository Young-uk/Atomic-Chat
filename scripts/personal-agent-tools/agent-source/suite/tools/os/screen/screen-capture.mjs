import { join } from "node:path";
import {
  ApprovalDeniedError,
  requireApproval
} from "../../../approval/dangerous-tool.mjs";
import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import {
  captureGeometry,
  fitWithin,
  SCREENSHOT_MAX_SIDE
} from "./screen-geometry.mjs";
import {
  macOnlyMessage,
  runScreenOp,
  screenRecordingMessage
} from "./screen-host.mjs";
import { screenChildEnv } from "./screen-jxa.mjs";
const OS_SCREEN_CAPTURE_TOOL = "os.screen.capture";
const SCREENSHOT_DIR = "atomic-agent-screens";
function screenshotDir(tmpDir, sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return join(tmpDir, SCREENSHOT_DIR, safe === "." || safe === ".." ? "default" : safe);
}
const SCREEN_RESULT_OPTIONS = { maxSummaryLength: 1200, maxTailLines: 40 };
function buildOsScreenCaptureTool(options) {
  const { deps } = options;
  return {
    name: OS_SCREEN_CAPTURE_TOOL,
    description: "Take a screenshot of the primary display (macOS). Saves a JPEG in the temp folder and returns its path, size and the pixel-to-point scale; look at it with vision.describe, then click with os.screen.click using the image's pixel coordinates. May ask the user first.",
    readonly: true,
    async run(rawArgs, ctx) {
      if (deps.platform !== "darwin") {
        return errorResult(macOnlyMessage(OS_SCREEN_CAPTURE_TOOL, deps.platform));
      }
      let region;
      try {
        region = parseRegion(rawArgs.region ?? flatRegion(rawArgs));
      } catch (error) {
        return errorResult(error.message);
      }
      try {
        return await capture(options, region, ctx);
      } catch (error) {
        if (error instanceof ApprovalDeniedError) throw error;
        return errorResult(`screenshot failed: ${error.message}`);
      }
    }
  };
}
async function capture(options, region, ctx) {
  const { deps, geometry } = options;
  const probe = await runScreenOp(deps, { op: "probe" }, ctx);
  if (probe.screenRecording === false) {
    return errorResult(screenRecordingMessage(deps.env), {
      retryable: false,
      reason: "screen-recording-permission"
    });
  }
  const area = region ?? { x: 0, y: 0, width: probe.screen.width, height: probe.screen.height };
  if (area.x + area.width > probe.screen.width + 0.5 || area.y + area.height > probe.screen.height + 0.5) {
    return errorResult(
      `region ${describeRegion(area)} does not fit the primary display (${probe.screen.width}x${probe.screen.height} points)`
    );
  }
  const front = probe.frontmost?.name ?? "unknown";
  const what = region ? `region ${describeRegion(area)} of the primary display` : "the primary display";
  await requireApproval(
    options,
    {
      sessionId: ctx.sessionId,
      tool: OS_SCREEN_CAPTURE_TOOL,
      category: "screen_capture",
      reason: `take a screenshot of ${what}`,
      preview: `${OS_SCREEN_CAPTURE_TOOL}: screenshot of ${what}
frontmost app: ${front}`,
      affectedResources: ["screen"]
    },
    ctx.signal
  );
  const env = screenChildEnv(deps.env);
  const dir = screenshotDir(deps.tmpDir, ctx.sessionId);
  await deps.ensureDir(dir);
  const path = join(dir, `screen-${stamp(deps.now())}.jpg`);
  const shot = await deps.run("screencapture", screencaptureArgs(path, region), {
    cwd: ctx.workingDir,
    signal: ctx.signal,
    timeoutMs: 2e4,
    env
  });
  const bytes = shot.exitCode === 0 ? await deps.fileSize(path).catch(() => 0) : 0;
  if (bytes === 0) {
    const why = shot.stderr.trim() || `screencapture exit ${shot.exitCode ?? "none"}`;
    return errorResult(`screenshot failed: ${why}. ${screenRecordingMessage(deps.env)}`, {
      retryable: false,
      reason: "capture-failed"
    });
  }
  const size = await readPixelSize(deps, path, ctx, env);
  const fit = fitWithin(size.width, size.height);
  if (fit.resize) {
    const resized = await deps.run("sips", ["-Z", String(SCREENSHOT_MAX_SIDE), path], {
      cwd: ctx.workingDir,
      signal: ctx.signal,
      timeoutMs: 2e4,
      env
    });
    if (resized.exitCode !== 0) {
      return errorResult(`downscaling the screenshot failed: ${resized.stderr.trim()}`);
    }
  }
  const image = fit.resize ? await readPixelSize(deps, path, ctx, env) : size;
  const mapped = captureGeometry(area, image);
  geometry.set(ctx.sessionId, mapped);
  const shown = path;
  const lines = [
    `saved ${shown} (${image.width}x${image.height} px) of ${what} (${probe.screen.width}x${probe.screen.height} points); frontmost app: ${front}.`,
    `scale ${mapped.scale.toFixed(4)} image px per screen point${region ? `, origin ${area.x},${area.y}` : ""}.`,
    `Look at it with vision.describe { "path": "${shown}" }. Give os.screen.click the image's pixel x,y as they are; this capture's scale and origin are remembered.`
  ];
  if (probe.screenRecording === null) {
    lines.push(
      "Screen Recording permission could not be checked: if the picture shows only the desktop background, the permission is missing."
    );
  }
  return compressToolResult(
    {
      tool: OS_SCREEN_CAPTURE_TOOL,
      status: "ok",
      output: lines.join("\n"),
      details: {
        path,
        imageWidth: image.width,
        imageHeight: image.height,
        scale: mapped.scale,
        originX: mapped.originX,
        originY: mapped.originY,
        screenWidth: probe.screen.width,
        screenHeight: probe.screen.height,
        frontmost: probe.frontmost,
        bytes
      }
    },
    SCREEN_RESULT_OPTIONS
  );
}
function screencaptureArgs(path, region) {
  const args = ["-x", "-t", "jpg"];
  if (region) {
    args.push("-R", [region.x, region.y, region.width, region.height].join(","));
  }
  args.push(path);
  return args;
}
function flatRegion(args) {
  const keys = ["x", "y", "width", "height"];
  if (keys.every((k) => args[k] === void 0 || args[k] === null)) return void 0;
  return { x: args.x, y: args.y, width: args.width, height: args.height };
}
function parseRegion(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("`region` must be an object { x, y, width, height } in screen points");
  }
  const r = raw;
  const values = [r.x, r.y, r.width, r.height];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error("`region` needs numeric x, y, width and height (screen points)");
  }
  const [x, y, width, height] = values;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error("`region` x and y must be >= 0 and width, height > 0");
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
async function readPixelSize(deps, path, ctx, env) {
  const result = await deps.run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], {
    cwd: ctx.workingDir,
    signal: ctx.signal,
    timeoutMs: 1e4,
    env
  });
  const width = Number(/pixelWidth:\s*(\d+)/.exec(result.stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(result.stdout)?.[1]);
  if (result.exitCode !== 0 || !(width > 0) || !(height > 0)) {
    throw new Error(`could not read the screenshot size: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return { width, height };
}
function describeRegion(r) {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}
function stamp(now) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}
function errorResult(message, details = {}) {
  return compressToolResult(
    { tool: OS_SCREEN_CAPTURE_TOOL, status: "error", output: message, details },
    SCREEN_RESULT_OPTIONS
  );
}
export {
  OS_SCREEN_CAPTURE_TOOL,
  SCREENSHOT_DIR,
  buildOsScreenCaptureTool,
  parseRegion,
  screencaptureArgs,
  screenshotDir
};
