import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPlaywrightCore } from "../../native/load-playwright-core.mjs";
import { findChromeExecutable } from "../browser/find-chrome-executable.mjs";
import {
  MISSING_SELECTOR_GLOBAL,
  MISSING_SELECTOR_INIT_SCRIPT,
  sampleProbes
} from "./page-probe-script.mjs";
const LIST_CAP = 50;
const STEP_TIMEOUT_MS = 5e3;
const LOAD_TIMEOUT_MS = 3e4;
function defaultBrowserLauncher(config) {
  return async () => {
    const pw = await loadPlaywrightCore();
    const reasons = [];
    const args = config.browser.noSandbox ? ["--no-sandbox"] : [];
    let executable = null;
    try {
      executable = findChromeExecutable({
        executablePath: config.browser.executablePath,
        channel: config.browser.channel
      })?.path ?? null;
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
    if (executable !== null) {
      try {
        return await pw.chromium.launch({ executablePath: executable, headless: true, args });
      } catch (err) {
        reasons.push(`${executable}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    } else if (reasons.length === 0) {
      reasons.push("no Chromium-family browser found (Chrome, Edge, Brave, Chromium)");
    }
    try {
      return await pw.chromium.launch({ headless: true, args });
    } catch (err) {
      reasons.push(`playwright chromium: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
    throw new Error(`no browser available: ${reasons.join("; ")}`);
  };
}
function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function push(list, entry) {
  if (list.length < LIST_CAP) list.push(entry);
}
async function runStep(page, step) {
  switch (step.action) {
    case "click":
      await page.click(step.selector ?? "", { timeout: STEP_TIMEOUT_MS });
      return;
    case "key":
      await page.keyboard.press(step.key ?? "");
      return;
    case "type":
      if (step.selector !== void 0) {
        await page.locator(step.selector).pressSequentially(step.text ?? "", { timeout: STEP_TIMEOUT_MS });
      } else {
        await page.keyboard.type(step.text ?? "");
      }
      return;
    case "wait":
      await page.waitForTimeout(Math.min(step.ms ?? 0, 6e4));
      return;
  }
}
function describeStep(step) {
  const detail = step.selector ?? step.key ?? step.text ?? (step.ms === void 0 ? "" : `${step.ms}ms`);
  return `${step.action} ${JSON.stringify(detail)}`;
}
async function runPageKind(args, ctx) {
  const started = Date.now();
  const errors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const requestFailures = [];
  let missingSelectors = [];
  let probes = {};
  const done = (partial) => ({
    errors,
    consoleErrors,
    consoleWarnings,
    requestFailures,
    missingSelectors,
    probes,
    durationMs: Date.now() - started,
    ...partial
  });
  let target;
  if (args.url !== void 0) {
    target = args.url;
  } else {
    const file = resolve(ctx.cwd, args.path ?? "");
    if (!existsSync(file)) {
      return done({ target: file, launched: false, loaded: false, error: `no such file: ${args.path}` });
    }
    target = pathToFileURL(file).href;
  }
  let browser;
  try {
    browser = await ctx.launch();
  } catch (err) {
    return done({ target, launched: false, loaded: false, error: err instanceof Error ? err.message : String(err) });
  }
  const deadline = setTimeout(() => {
    push(errors, `run exceeded timeoutMs (${args.timeoutMs})`);
    void browser.close().catch(() => {
    });
  }, args.timeoutMs);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    if (!args.network) {
      await context.route((url) => /^https?:$/.test(url.protocol) && !isLoopbackHost(url.hostname), (route) => {
        push(requestFailures, `${route.request().url()} blocked (network: false)`);
        return route.abort("blockedbyclient");
      });
    }
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      const message = err.message.split("\n")[0] ?? String(err);
      push(errors, err.name.length > 0 && !message.startsWith(err.name) ? `${err.name}: ${message}` : message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") push(consoleErrors, msg.text());
      else if (msg.type() === "warning") push(consoleWarnings, msg.text());
    });
    page.on("requestfailed", (req) => {
      const why = req.failure()?.errorText ?? "failed";
      if (!why.includes("BLOCKED_BY_CLIENT")) push(requestFailures, `${req.url()} ${why}`);
    });
    await page.addInitScript(MISSING_SELECTOR_INIT_SCRIPT);
    try {
      await page.goto(target, { waitUntil: "load", timeout: Math.min(LOAD_TIMEOUT_MS, args.timeoutMs) });
    } catch (err) {
      return done({ target, launched: true, loaded: false, error: `page load failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` });
    }
    for (const step of args.script ?? []) {
      if (ctx.signal?.aborted) break;
      try {
        await runStep(page, step);
      } catch (err) {
        push(errors, `script step ${describeStep(step)} failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }
    probes = await sampleProbes(args.probes ?? [], args.seconds, (expr) => page.evaluate(expr), ctx.signal);
    try {
      const recorded = await page.evaluate(`window[${JSON.stringify(MISSING_SELECTOR_GLOBAL)}]`);
      missingSelectors = Array.isArray(recorded) ? recorded.map(String) : [];
    } catch {
    }
    return done({ target, launched: true, loaded: true });
  } catch (err) {
    return done({ target, launched: true, loaded: false, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {
    });
  }
}
export {
  defaultBrowserLauncher,
  isLoopbackHost,
  runPageKind
};
