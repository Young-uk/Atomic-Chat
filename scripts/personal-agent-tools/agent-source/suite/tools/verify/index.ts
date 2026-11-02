import type { DangerousToolOptions } from "../../approval/dangerous-tool.mjs";
import type { AtomicAgentConfig } from "../../config/index.mjs";
import type { ToolRegistry } from "../tool-registry.mjs";
import { buildVerifyRunTool } from "./verify-run.mjs";
import { verifySyntaxTool } from "./verify-syntax.mjs";

export {
  VERIFY_SYNTAX_TOOL,
  VERIFY_SYNTAX_MAX_FILES,
  VERIFY_SUMMARY_MAX_CHARS,
  parseVerifySyntaxArgs,
  verifySyntax,
  verifySyntaxTool,
} from "./verify-syntax.mjs";
export type { VerifySyntaxReport } from "./verify-syntax.mjs";
export type { SyntaxFileResult } from "./syntax-check-types.mjs";
export {
  checkJavaScriptFile,
  checkJavaScriptSource,
  checkPythonFile,
  checkShellFile,
  nodeCheck,
  nodeForSyntaxCheck,
  runChecker,
} from "./check-script-syntax.mjs";
export {
  checkLanguageFile,
  LANGUAGE_SYNTAX_EXTENSIONS,
} from "./check-language-syntax.mjs";
export type { CheckerRun } from "./check-script-syntax.mjs";
export { checkCssSource, CSS_CHECKER } from "./check-css-syntax.mjs";
export {
  checkHtmlSource,
  extractInlineScripts,
  trailingContentWarning,
  HTML_CHECKER,
} from "./check-html-syntax.mjs";
export {
  checkTypeScriptFiles,
  findTsconfig,
  findTscBinary,
  TS_CHECKER,
} from "./check-typescript-syntax.mjs";

export {
  VERIFY_RUN_TOOL,
  buildVerifyRunTool,
  describeVerifyRun,
} from "./verify-run.mjs";
export type { VerifyRunToolOptions } from "./verify-run.mjs";
export { runVerify, runChecks } from "./run-verify.mjs";
export type { VerifyRunResult, VerifyRunContext } from "./run-verify.mjs";
export {
  parseVerifyRunArgs,
  VERIFY_RUN_DEFAULT_TIMEOUT_MS,
  VERIFY_RUN_MAX_TIMEOUT_MS,
  VERIFY_READY_DEFAULT_TIMEOUT_MS,
  VERIFY_PAGE_DEFAULT_SECONDS,
  VERIFY_PAGE_MAX_SECONDS,
} from "./verify-run-args.mjs";
export type {
  VerifyRunArgs,
  VerifyRunKind,
  VerifyRequestSpec,
  VerifyScriptStep,
  VerifyProbe,
} from "./verify-run-args.mjs";
export { evaluateCheck, evaluateChecks, tokenizeCheck } from "./verify-checks.mjs";
export type { CheckOutcome, CheckSubject } from "./verify-checks.mjs";
export {
  createVerifyWorkspace,
  copyTreeWithExclusions,
  measureTree,
  VERIFY_COPY_EXCLUDED,
  VERIFY_COPY_MAX_BYTES,
} from "./verify-workspace-copy.mjs";
export type { VerifyWorkspace, CreateWorkspaceOptions } from "./verify-workspace-copy.mjs";
export {
  networkBlockEnv,
  resolveInvocation,
  spawnVerifyProcess,
  NETWORK_BLOCK_PROXY,
  OUTPUT_TAIL_CHARS,
  TailBuffer,
} from "./spawn-verify-process.mjs";
export type { VerifyProcess, VerifyProcessExit } from "./spawn-verify-process.mjs";
export { runCommandKind } from "./run-command-kind.mjs";
export type { CommandRunOutcome } from "./run-command-kind.mjs";
export { runServiceKind } from "./run-service-kind.mjs";
export type { ServiceRunOutcome, RequestOutcome, FetchLike } from "./run-service-kind.mjs";
export { runPageKind, defaultBrowserLauncher } from "./run-page-kind.mjs";
export type { PageRunOutcome, BrowserLauncher } from "./run-page-kind.mjs";
export { downsample, sampleProbes, MISSING_SELECTOR_INIT_SCRIPT } from "./page-probe-script.mjs";
export type { ProbeSample } from "./page-probe-script.mjs";
export { renderVerifyRunSummary, VERIFY_RUN_SUMMARY_MAX_CHARS } from "./verify-run-summary.mjs";

export interface RegisterVerifyToolsOptions extends DangerousToolOptions {
  config: Pick<AtomicAgentConfig, "browser">;
}

/**
 * Register the `verify.*` family. Both tools are `readonly` so the fusion
 * orchestrator gate and plan mode let them run — verification reads and
 * executes copies, it never changes the workspace.
 */
export function registerVerifyTools(
  registry: ToolRegistry,
  options: RegisterVerifyToolsOptions,
): void {
  registry.register(verifySyntaxTool);
  registry.register(
    buildVerifyRunTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired,
      config: options.config,
    }),
  );
}
