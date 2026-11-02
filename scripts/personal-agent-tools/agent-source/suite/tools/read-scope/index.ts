export {
  READ_TOOL_TARGETS,
  SHELL_TOOL,
  URL_LIKE,
} from "./read-scope-targets.mjs";
export type { ReadTargetsOf } from "./read-scope-targets.mjs";
export {
  canonical,
  checkWorkerRead,
  findSessionReadOutside,
  isOutsideReadRoots,
  isScratchPath,
  isUnderAny,
  READ_REFUSAL_REASON,
  scratchDirs,
  sessionReadRefusal,
  sessionReadRoots,
  WORKER_READ_REFUSAL_REASON,
  workerReadRefusal,
} from "./read-scope.mjs";
export {
  looksLikeNamedPath,
  pathsNamedIn,
  userNamedPaths,
} from "./read-scope-roots.mjs";
export type { UserNamedPathOptions } from "./read-scope-roots.mjs";
export {
  defaultShellScopeEnv,
  findShellPathOutsideScope,
  shellCommandLine,
  shellTokens,
} from "./read-scope-shell.mjs";
export type { ShellScopeEnv } from "./read-scope-shell.mjs";
export {
  ReadOutsideApprover,
  readOutsidePrompt,
  shellReadOutsidePrompt,
  widenedReadRoot,
} from "./read-scope-approval.mjs";
export type { ReadOutsidePrompt } from "./read-scope-approval.mjs";
export {
  findShellStateSecrets,
  findStateSecretReads,
} from "./state-secrets.mjs";
export type { StateSecrets } from "./state-secrets.mjs";
export { confineReads, confineWorkerReads } from "./confine-reads.mjs";
export type { ConfineReadsOptions } from "./confine-reads.mjs";
// The worker-era name of the targets map, kept so fusion code reads the same.
export { READ_TOOL_TARGETS as WORKER_READ_TOOL_TARGETS } from "./read-scope-targets.mjs";
