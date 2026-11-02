import { scrubGithubToken } from "./github-token.mjs";
class GithubApiError extends Error {
  status;
  constructor(message, status) {
    super(scrubGithubToken(message));
    this.name = "GithubApiError";
    this.status = status;
  }
}
export {
  GithubApiError
};
