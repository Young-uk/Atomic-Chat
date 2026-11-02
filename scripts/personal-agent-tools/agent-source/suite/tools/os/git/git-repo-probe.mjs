import { runGit } from "./git-runner.mjs";
async function resolveGitToplevel(options) {
  const result = await runGit({
    repo: options.repo,
    workingDir: options.workingDir,
    args: ["rev-parse", "--show-toplevel"],
    signal: options.signal,
    timeoutMs: 5e3
  });
  const root = result.stdout.trim();
  if (result.exitCode !== 0 || root.length === 0) {
    const stderr = result.stderr.trim();
    return {
      ok: false,
      message: stderr || `not a git repository: ${result.repoRoot}`
    };
  }
  return { ok: true, root };
}
async function hasHeadCommit(options) {
  const result = await runGit({
    repo: options.repo,
    workingDir: options.workingDir,
    args: ["rev-parse", "--verify", "-q", "HEAD"],
    signal: options.signal,
    timeoutMs: 5e3
  });
  return result.exitCode === 0;
}
async function describeHead(options) {
  const [branchResult, hashResult] = await Promise.all([
    runGit({
      repo: options.repo,
      workingDir: options.workingDir,
      args: ["symbolic-ref", "--short", "-q", "HEAD"],
      signal: options.signal,
      timeoutMs: 5e3
    }),
    runGit({
      repo: options.repo,
      workingDir: options.workingDir,
      args: ["rev-parse", "--verify", "-q", "HEAD"],
      signal: options.signal,
      timeoutMs: 5e3
    })
  ]);
  const branch = branchResult.stdout.trim();
  const hash = hashResult.exitCode === 0 ? hashResult.stdout.trim() : "";
  return {
    branch: branch.length > 0 ? branch : null,
    hash: hash.length > 0 ? hash : null,
    shortHash: hash.length > 0 ? hash.slice(0, 7) : null
  };
}
export {
  describeHead,
  hasHeadCommit,
  resolveGitToplevel
};
