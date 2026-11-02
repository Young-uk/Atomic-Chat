import { GithubApiError } from "./github-api-types.mjs";
import { GithubApiError as GithubApiError2 } from "./github-api-types.mjs";
import {
  asRecord,
  parseIssue,
  parsePullRequest,
  readErrorMessage
} from "./github-api-parse.mjs";
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_BODY_LIMIT = 65536;
class GithubApi {
  constructor(opts) {
    this.opts = opts;
    this.base = (opts.baseUrl ?? GITHUB_API_BASE).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 2e4;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.userAgent = opts.userAgent ?? "atomic-agent";
  }
  base;
  timeoutMs;
  fetchImpl;
  userAgent;
  /** Who the token belongs to, and what it may do. */
  async whoami() {
    const { body, headers } = await this.request("GET", "/user");
    const rec = asRecord(body);
    const login = rec?.login;
    if (typeof login !== "string" || login.length === 0) {
      throw new GithubApiError("GitHub returned a malformed user.", 0);
    }
    const scopesHeader = headers.get("x-oauth-scopes") ?? "";
    const scopes = scopesHeader.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    return {
      login,
      name: typeof rec?.name === "string" ? rec.name : null,
      scopes
    };
  }
  async getRepo(owner, repo) {
    const { body } = await this.request(
      "GET",
      `/repos/${enc(owner)}/${enc(repo)}`
    );
    const rec = asRecord(body);
    const fullName = rec?.full_name;
    const defaultBranch = rec?.default_branch;
    if (typeof fullName !== "string" || typeof defaultBranch !== "string") {
      throw new GithubApiError("GitHub returned a malformed repository.", 0);
    }
    const perms = asRecord(rec?.permissions);
    return {
      fullName,
      defaultBranch,
      private: rec?.private === true,
      htmlUrl: typeof rec?.html_url === "string" ? rec.html_url : "",
      permissions: {
        push: perms?.push === true,
        admin: perms?.admin === true
      }
    };
  }
  async createPullRequest(input) {
    const { body } = await this.request(
      "POST",
      `/repos/${enc(input.owner)}/${enc(input.repo)}/pulls`,
      {
        title: input.title,
        head: input.head,
        base: input.base,
        ...input.body === void 0 ? {} : { body: input.body },
        ...input.draft === void 0 ? {} : { draft: input.draft }
      }
    );
    return parsePullRequest(body);
  }
  async listPullRequests(input) {
    const limit = clampLimit(input.limit);
    const state = input.state ?? "open";
    const { body } = await this.request(
      "GET",
      `/repos/${enc(input.owner)}/${enc(input.repo)}/pulls?state=${state}&per_page=${limit}&sort=updated&direction=desc`
    );
    if (!Array.isArray(body)) {
      throw new GithubApiError("GitHub returned a malformed PR list.", 0);
    }
    return body.map(parsePullRequest);
  }
  async createIssue(input) {
    const { body } = await this.request(
      "POST",
      `/repos/${enc(input.owner)}/${enc(input.repo)}/issues`,
      {
        title: input.title,
        ...input.body === void 0 ? {} : { body: input.body },
        ...input.labels === void 0 ? {} : { labels: [...input.labels] }
      }
    );
    return parseIssue(body);
  }
  async listIssues(input) {
    const limit = clampLimit(input.limit);
    const state = input.state ?? "open";
    const labels = input.labels && input.labels.length > 0 ? `&labels=${encodeURIComponent(input.labels.join(","))}` : "";
    const { body } = await this.request(
      "GET",
      `/repos/${enc(input.owner)}/${enc(input.repo)}/issues?state=${state}&per_page=${limit}${labels}`
    );
    if (!Array.isArray(body)) {
      throw new GithubApiError("GitHub returned a malformed issue list.", 0);
    }
    return body.map(parseIssue);
  }
  /** Comment on an issue or a pull request (same endpoint on GitHub). */
  async addIssueComment(input) {
    const { body } = await this.request(
      "POST",
      `/repos/${enc(input.owner)}/${enc(input.repo)}/issues/${input.number}/comments`,
      { body: input.body }
    );
    const rec = asRecord(body);
    if (typeof rec?.id !== "number") {
      throw new GithubApiError("GitHub returned a malformed comment.", 0);
    }
    return {
      id: rec.id,
      htmlUrl: typeof rec.html_url === "string" ? rec.html_url : ""
    };
  }
  async request(method, path, payload) {
    let res;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": this.userAgent,
          ...payload === void 0 ? {} : { "Content-Type": "application/json" }
        },
        ...payload === void 0 ? {} : { body: JSON.stringify(payload) },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new GithubApiError(`Could not reach GitHub: ${msg}`, 0);
    }
    if (res.status === 401) {
      throw new GithubApiError(
        "GitHub rejected the token (HTTP 401). Check it in the Integrations tab.",
        401
      );
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const detail = await readErrorMessage(res);
      const rateLimited = remaining === "0" || res.status === 429 || res.headers.has("retry-after");
      throw new GithubApiError(
        rateLimited ? `GitHub rate limit reached (HTTP ${res.status}). ${detail}`.trim() : `GitHub refused ${method} ${stripQuery(path)} (HTTP 403): ${detail || "the token lacks the required permission"}`,
        res.status
      );
    }
    if (res.status === 404) {
      throw new GithubApiError(
        `GitHub returned 404 for ${method} ${stripQuery(path)} \u2014 the repository does not exist or the token cannot see it.`,
        404
      );
    }
    if (!res.ok) {
      const detail = await readErrorMessage(res);
      throw new GithubApiError(
        `GitHub returned HTTP ${res.status} for ${method} ${stripQuery(path)}${detail ? `: ${detail}` : "."}`,
        res.status
      );
    }
    if (res.status === 204) return { body: void 0, headers: res.headers };
    try {
      return { body: await res.json(), headers: res.headers };
    } catch {
      return { body: void 0, headers: res.headers };
    }
  }
}
function enc(segment) {
  return encodeURIComponent(segment);
}
function stripQuery(path) {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}
function clampLimit(raw) {
  if (raw === void 0 || !Number.isFinite(raw)) return 20;
  return Math.max(1, Math.min(100, Math.floor(raw)));
}
export {
  GITHUB_API_BASE,
  GITHUB_BODY_LIMIT,
  GithubApi,
  GithubApiError2 as GithubApiError
};
