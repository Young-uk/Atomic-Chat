import { resolve } from "node:path";
import { buildOsShellTool } from "./shell/shell.mjs";
import { osFsReadTool } from "./fs/fs-read.mjs";
import { buildOsFsWriteTool } from "./fs/fs-write.mjs";
import { buildOsFsTrashTool } from "./fs/fs-trash.mjs";
import { osFsListTool } from "./fs/fs-list.mjs";
import { osFsGlobTool } from "./fs/fs-glob.mjs";
import { buildOsFsLocateProjectTool } from "./fs/fs-locate-project.mjs";
import { buildOsFsGrepTool } from "./fs/fs-grep.mjs";
import { buildOsFsEditTool } from "./fs/fs-edit.mjs";
import { buildOsFsReadDocumentTool } from "./read-document/index.mjs";
import {
  buildOsFsArchiveListTool,
  buildOsFsArchiveReadEntryTool,
  buildOsFsArchiveExtractTool
} from "./archive/index.mjs";
import { buildOsHttpRequestTool } from "./web/http-request.mjs";
import { buildOsWebFetchTool } from "./web/web-fetch.mjs";
import { buildOsWebSearchTool } from "./web-search/index.mjs";
import { osClipboardReadTool, osClipboardWriteTool } from "./clipboard.mjs";
import { osWindowListTool, osWindowFocusTool } from "./window.mjs";
import { buildOsEmailInboxTool, buildOsEmailSendTool } from "./email.mjs";
import { osNotifyTool } from "./notify.mjs";
import { osFsHashTool } from "./fs/fs-hash.mjs";
import { osFsDiffTool } from "./fs/fs-diff.mjs";
import { buildOsFsPatchTool } from "./fs/fs-patch.mjs";
import { buildOsFsRestoreTool } from "./fs/fs-restore.mjs";
import { buildOsFsMoveTool } from "./fs/fs-move.mjs";
import { FileRestoreStore } from "./fs/fs-restore-store.mjs";
import { osFsWatchTool } from "./fs/fs-watch.mjs";
import {
  osGitStatusTool,
  osGitLogTool,
  osGitDiffTool,
  osGitShowTool,
  osGitBlameTool,
  osGitBranchTool,
  buildOsGitInitTool,
  buildOsGitAddTool,
  buildOsGitCheckoutTool,
  buildOsGitCommitTool,
  buildOsGitRemoteTool,
  buildOsGitFetchTool,
  buildOsGitPullTool,
  buildOsGitPushTool,
  buildOsGitCloneTool
} from "./git/index.mjs";
import { osProcListTool, buildOsProcKillTool } from "./proc/index.mjs";
import { buildOsShellTool as buildOsShellTool2 } from "./shell/shell.mjs";
import { osFsReadTool as osFsReadTool2 } from "./fs/fs-read.mjs";
import { buildOsFsWriteTool as buildOsFsWriteTool2 } from "./fs/fs-write.mjs";
import { buildOsFsTrashTool as buildOsFsTrashTool2 } from "./fs/fs-trash.mjs";
import { osFsListTool as osFsListTool2 } from "./fs/fs-list.mjs";
import { osFsGlobTool as osFsGlobTool2 } from "./fs/fs-glob.mjs";
import {
  buildOsFsLocateProjectTool as buildOsFsLocateProjectTool2
} from "./fs/fs-locate-project.mjs";
import { buildOsFsGrepTool as buildOsFsGrepTool2 } from "./fs/fs-grep.mjs";
import { buildOsFsEditTool as buildOsFsEditTool2 } from "./fs/fs-edit.mjs";
import { buildOsFsReadDocumentTool as buildOsFsReadDocumentTool2 } from "./read-document/index.mjs";
import {
  buildOsFsArchiveListTool as buildOsFsArchiveListTool2,
  buildOsFsArchiveReadEntryTool as buildOsFsArchiveReadEntryTool2,
  buildOsFsArchiveExtractTool as buildOsFsArchiveExtractTool2
} from "./archive/index.mjs";
import { buildOsHttpRequestTool as buildOsHttpRequestTool2 } from "./web/http-request.mjs";
import { buildOsWebFetchTool as buildOsWebFetchTool2 } from "./web/web-fetch.mjs";
import { buildOsWebSearchTool as buildOsWebSearchTool2 } from "./web-search/index.mjs";
import { osClipboardReadTool as osClipboardReadTool2, osClipboardWriteTool as osClipboardWriteTool2 } from "./clipboard.mjs";
import { osWindowListTool as osWindowListTool2, osWindowFocusTool as osWindowFocusTool2 } from "./window.mjs";
import { osNotifyTool as osNotifyTool2 } from "./notify.mjs";
import { OS_SCREEN_TOOL_NAMES, registerOsScreenTools } from "./screen/index.mjs";
import { buildOsEmailInboxTool as buildOsEmailInboxTool2, buildOsEmailSendTool as buildOsEmailSendTool2 } from "./email.mjs";
import { osFsHashTool as osFsHashTool2 } from "./fs/fs-hash.mjs";
import { osFsDiffTool as osFsDiffTool2 } from "./fs/fs-diff.mjs";
import { buildOsFsPatchTool as buildOsFsPatchTool2 } from "./fs/fs-patch.mjs";
import { buildOsFsRestoreTool as buildOsFsRestoreTool2 } from "./fs/fs-restore.mjs";
import { buildOsFsMoveTool as buildOsFsMoveTool2 } from "./fs/fs-move.mjs";
import { FileRestoreStore as FileRestoreStore2 } from "./fs/fs-restore-store.mjs";
import { checkInputReplacement, refuseInputReplacement } from "./fs/fs-input-guard.mjs";
import { DeclaredInputsRegistry } from "./fs/fs-declared-inputs.mjs";
import { osFsWatchTool as osFsWatchTool2 } from "./fs/fs-watch.mjs";
import {
  osGitStatusTool as osGitStatusTool2,
  osGitLogTool as osGitLogTool2,
  osGitDiffTool as osGitDiffTool2,
  osGitShowTool as osGitShowTool2,
  osGitBlameTool as osGitBlameTool2,
  osGitBranchTool as osGitBranchTool2,
  buildOsGitInitTool as buildOsGitInitTool2,
  buildOsGitAddTool as buildOsGitAddTool2,
  buildOsGitCheckoutTool as buildOsGitCheckoutTool2,
  buildOsGitCommitTool as buildOsGitCommitTool2,
  buildOsGitRemoteTool as buildOsGitRemoteTool2,
  buildOsGitFetchTool as buildOsGitFetchTool2,
  buildOsGitPullTool as buildOsGitPullTool2,
  buildOsGitPushTool as buildOsGitPushTool2,
  buildOsGitCloneTool as buildOsGitCloneTool2
} from "./git/index.mjs";
import { osProcListTool as osProcListTool2, buildOsProcKillTool as buildOsProcKillTool2 } from "./proc/index.mjs";
import { isGogCommand } from "./shell-command-guard/index.mjs";
import {
  describeShellTimeoutDefault,
  formatShellDetachNotice,
  formatShellDuration,
  formatShellElapsed,
  formatShellTimeoutNotice,
  resolveShellTimeout
} from "./shell/shell-timeout.mjs";
import {
  DEFAULT_SHELL_JOB_MAX_MS,
  DEFAULT_SHELL_MAX_JOBS,
  ShellJobRegistry
} from "./shell/shell-jobs.mjs";
function registerOsTools(registry, options) {
  registry.register(
    buildOsShellTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired,
      defaultTimeoutMs: options.config.tools.shell.defaultTimeoutMs,
      envPassthrough: options.config.tools.shell.envPassthrough,
      ...options.shellPolicy === void 0 ? {} : { shellPolicy: options.shellPolicy },
      ...options.shellJobs === void 0 ? {} : { jobs: options.shellJobs }
    })
  );
  const fsMutation = {
    approvals: options.approvals,
    approvalRequired: options.approvalRequired,
    trustConfigPaths: options.trustConfigPaths,
    ...options.stateDir === void 0 ? {} : { restore: new FileRestoreStore(resolve(options.stateDir, "restore")) },
    ...options.resolveOriginalRequest === void 0 ? {} : { resolveOriginalRequest: options.resolveOriginalRequest },
    ...options.resolvePreviousReply === void 0 ? {} : { resolvePreviousReply: options.resolvePreviousReply },
    ...options.declaredInputs === void 0 ? {} : { declaredInputs: options.declaredInputs }
  };
  registry.register(osFsReadTool);
  registry.register(buildOsFsWriteTool(fsMutation));
  registry.register(buildOsFsTrashTool(options));
  registry.register(osFsListTool);
  registry.register(osFsGlobTool);
  registry.register(
    buildOsFsLocateProjectTool({
      listRecentSessions: options.listRecentSessionDirs,
      projectRoots: options.config.projects.roots
    })
  );
  registry.register(buildOsFsGrepTool());
  registry.register(buildOsFsEditTool(fsMutation));
  registry.register(buildOsFsReadDocumentTool());
  registry.register(buildOsFsArchiveListTool());
  registry.register(buildOsFsArchiveReadEntryTool());
  registry.register(
    buildOsFsArchiveExtractTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired,
      trustConfigPaths: options.trustConfigPaths
    })
  );
  registry.register(
    buildOsHttpRequestTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired,
      config: options.config
    })
  );
  registry.register(
    buildOsWebSearchTool({
      config: options.config,
      stateDir: options.stateDir,
      ...options.webSearchKeyHelp === void 0 ? {} : { keyHelp: options.webSearchKeyHelp }
    })
  );
  registry.register(buildOsWebFetchTool({ config: options.config }));
  registry.register(osClipboardReadTool);
  registry.register(osClipboardWriteTool);
  registry.register(osWindowListTool);
  registry.register(osWindowFocusTool);
  registry.register(osNotifyTool);
  registry.register(
    buildOsEmailInboxTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired
    })
  );
  registry.register(
    buildOsEmailSendTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired
    })
  );
  registry.register(osFsHashTool);
  registry.register(osFsDiffTool);
  registry.register(buildOsFsPatchTool(fsMutation));
  registry.register(buildOsFsRestoreTool(fsMutation));
  registry.register(buildOsFsMoveTool(fsMutation));
  registry.register(osFsWatchTool);
  registry.register(osGitStatusTool);
  registry.register(osGitLogTool);
  registry.register(osGitDiffTool);
  registry.register(osGitShowTool);
  registry.register(osGitBlameTool);
  registry.register(osGitBranchTool);
  const gitWriteOptions = {
    approvals: options.approvals,
    approvalRequired: options.approvalRequired,
    trustConfigPaths: options.trustConfigPaths
  };
  registry.register(buildOsGitInitTool(gitWriteOptions));
  registry.register(buildOsGitAddTool(gitWriteOptions));
  registry.register(buildOsGitCheckoutTool(gitWriteOptions));
  registry.register(buildOsGitCommitTool(gitWriteOptions));
  const gitRemote = {
    approvals: options.approvals,
    approvalRequired: options.approvalRequired,
    isRemoteSyncEnabled: options.shellPolicy?.isGitRemoteSyncEnabled ?? (() => false)
  };
  registry.register(buildOsGitRemoteTool(gitRemote));
  registry.register(buildOsGitFetchTool(gitRemote));
  registry.register(buildOsGitPullTool(gitRemote));
  registry.register(buildOsGitPushTool(gitRemote));
  registry.register(buildOsGitCloneTool(gitRemote));
  registry.register(osProcListTool);
  registry.register(
    buildOsProcKillTool({
      approvals: options.approvals,
      approvalRequired: options.approvalRequired
    })
  );
}
export {
  DEFAULT_SHELL_JOB_MAX_MS,
  DEFAULT_SHELL_MAX_JOBS,
  DeclaredInputsRegistry,
  FileRestoreStore2 as FileRestoreStore,
  OS_SCREEN_TOOL_NAMES,
  ShellJobRegistry,
  buildOsEmailInboxTool2 as buildOsEmailInboxTool,
  buildOsEmailSendTool2 as buildOsEmailSendTool,
  buildOsFsArchiveExtractTool2 as buildOsFsArchiveExtractTool,
  buildOsFsArchiveListTool2 as buildOsFsArchiveListTool,
  buildOsFsArchiveReadEntryTool2 as buildOsFsArchiveReadEntryTool,
  buildOsFsEditTool2 as buildOsFsEditTool,
  buildOsFsGrepTool2 as buildOsFsGrepTool,
  buildOsFsLocateProjectTool2 as buildOsFsLocateProjectTool,
  buildOsFsMoveTool2 as buildOsFsMoveTool,
  buildOsFsPatchTool2 as buildOsFsPatchTool,
  buildOsFsReadDocumentTool2 as buildOsFsReadDocumentTool,
  buildOsFsRestoreTool2 as buildOsFsRestoreTool,
  buildOsFsTrashTool2 as buildOsFsTrashTool,
  buildOsFsWriteTool2 as buildOsFsWriteTool,
  buildOsGitAddTool2 as buildOsGitAddTool,
  buildOsGitCheckoutTool2 as buildOsGitCheckoutTool,
  buildOsGitCloneTool2 as buildOsGitCloneTool,
  buildOsGitCommitTool2 as buildOsGitCommitTool,
  buildOsGitFetchTool2 as buildOsGitFetchTool,
  buildOsGitInitTool2 as buildOsGitInitTool,
  buildOsGitPullTool2 as buildOsGitPullTool,
  buildOsGitPushTool2 as buildOsGitPushTool,
  buildOsGitRemoteTool2 as buildOsGitRemoteTool,
  buildOsHttpRequestTool2 as buildOsHttpRequestTool,
  buildOsProcKillTool2 as buildOsProcKillTool,
  buildOsShellTool2 as buildOsShellTool,
  buildOsWebFetchTool2 as buildOsWebFetchTool,
  buildOsWebSearchTool2 as buildOsWebSearchTool,
  checkInputReplacement,
  describeShellTimeoutDefault,
  formatShellDetachNotice,
  formatShellDuration,
  formatShellElapsed,
  formatShellTimeoutNotice,
  isGogCommand,
  osClipboardReadTool2 as osClipboardReadTool,
  osClipboardWriteTool2 as osClipboardWriteTool,
  osFsDiffTool2 as osFsDiffTool,
  osFsGlobTool2 as osFsGlobTool,
  osFsHashTool2 as osFsHashTool,
  osFsListTool2 as osFsListTool,
  osFsReadTool2 as osFsReadTool,
  osFsWatchTool2 as osFsWatchTool,
  osGitBlameTool2 as osGitBlameTool,
  osGitBranchTool2 as osGitBranchTool,
  osGitDiffTool2 as osGitDiffTool,
  osGitLogTool2 as osGitLogTool,
  osGitShowTool2 as osGitShowTool,
  osGitStatusTool2 as osGitStatusTool,
  osNotifyTool2 as osNotifyTool,
  osProcListTool2 as osProcListTool,
  osWindowFocusTool2 as osWindowFocusTool,
  osWindowListTool2 as osWindowListTool,
  refuseInputReplacement,
  registerOsScreenTools,
  registerOsTools,
  resolveShellTimeout
};
