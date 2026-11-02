import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  requireApproval
} from "../../../approval/dangerous-tool.mjs";
import {
  buildCredentialInjection,
  readGithubToken,
  redactSecret,
  sshBatchEnv
} from "./git-credentials.mjs";
import {
  GIT_FAILURE_SUMMARY_CHARS,
  GIT_FAILURE_TAIL_LINES
} from "./git-error-result.mjs";
import { runGit } from "./git-runner.mjs";
const REMOTE_SYNC_OFF_MESSAGE = "remote sync is off \u2014 this repository stays on this machine. Nothing was sent or fetched. The operator can turn it on under Integrations \u2192 GitHub \u2192 Remote sync; do not look for another way to reach the remote.";
const REMOTE_SYNC_OFF_SUMMARY_CHARS = 500;
function refuseWhenRemoteSyncOff(tool, options, details = {}) {
  if (options.isRemoteSyncEnabled()) return null;
  return compressToolResult(
    {
      tool,
      status: "error",
      output: `${tool}: ${REMOTE_SYNC_OFF_MESSAGE}`,
      details: { ...details, remoteSync: false, refused: true }
    },
    { maxSummaryLength: REMOTE_SYNC_OFF_SUMMARY_CHARS }
  );
}
async function requireGitRemoteApproval(options, request, signal) {
  await requireApproval(
    options,
    {
      sessionId: request.sessionId,
      tool: request.tool,
      category: "git_remote",
      reason: request.reason,
      preview: request.preview,
      affectedResources: request.affectedResources
    },
    signal
  );
}
async function runGitRemote(options, run) {
  const env = options.env ?? process.env;
  const token = readGithubToken(env);
  const injection = buildCredentialInjection(token);
  const result = await runGit({
    ...run,
    args: [...injection.args, ...run.args],
    env: { ...sshBatchEnv(env), ...injection.env }
  });
  return {
    ...result,
    stdout: redactSecret(result.stdout, token),
    stderr: redactSecret(result.stderr, token),
    // `args` echo the helper string, not the token, but scrub anyway.
    args: result.args.map((a) => redactSecret(a, token))
  };
}
function gitFailureResult(tool, result, details) {
  const stderr = result.stderr.trim() || result.stdout.trim() || "(no output)";
  const why = result.timedOut ? `git timed out after ${result.durationMs}ms` : `git exited with ${result.exitCode}`;
  return compressToolResult(
    {
      tool,
      status: "error",
      output: `${tool}: ${why}
${stderr}`,
      details: { ...details, exitCode: result.exitCode, timedOut: result.timedOut }
    },
    {
      maxSummaryLength: GIT_FAILURE_SUMMARY_CHARS,
      maxTailLines: GIT_FAILURE_TAIL_LINES
    }
  );
}
function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
export {
  REMOTE_SYNC_OFF_MESSAGE,
  REMOTE_SYNC_OFF_SUMMARY_CHARS,
  gitFailureResult,
  optionalString,
  refuseWhenRemoteSyncOff,
  requireGitRemoteApproval,
  runGitRemote
};
