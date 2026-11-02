/**
 * GitHub integration — token resolution, the REST client, and the two
 * pure helpers the git tools need. See README.md.
 */

export {
  GITHUB_NOT_CONNECTED,
  GITHUB_TOKEN_ENV,
  looksLikeGithubToken,
  resolveGithubToken,
  scrubGithubToken,
} from "./github-token.mjs";
export {
  formatRepoSlug,
  isGithubHttpsRemote,
  isGithubRemote,
  parseGithubRemote,
  parseRepoSlug,
} from "./parse-github-remote.mjs";
export type { GithubRepoRef } from "./parse-github-remote.mjs";
export {
  GITHUB_EXTRAHEADER_KEY,
  githubAuthGitEnv,
  githubAuthHeaderValue,
} from "./git-auth-header.mjs";
export {
  GITHUB_API_BASE,
  GITHUB_BODY_LIMIT,
  GithubApi,
  GithubApiError,
} from "./github-api.mjs";
export type {
  CreateIssueInput,
  CreatePullRequestInput,
  GithubApiOptions,
  GithubComment,
  GithubIdentity,
  GithubIssue,
  GithubPullRequest,
  GithubRepo,
} from "./github-api.mjs";
