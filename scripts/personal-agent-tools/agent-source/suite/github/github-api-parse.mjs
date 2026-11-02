import { GithubApiError } from "./github-api-types.mjs";
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : void 0;
}
async function readErrorMessage(res) {
  try {
    const body = asRecord(await res.json());
    const parts = [];
    if (typeof body?.message === "string") parts.push(body.message);
    if (Array.isArray(body?.errors)) {
      for (const e of body.errors) {
        const rec = asRecord(e);
        if (typeof rec?.message === "string") parts.push(rec.message);
        else if (typeof e === "string") parts.push(e);
      }
    }
    return parts.join(" \u2014 ").slice(0, 400);
  } catch {
    return "";
  }
}
function parsePullRequest(raw) {
  const rec = asRecord(raw);
  const number = rec?.number;
  const title = rec?.title;
  if (typeof number !== "number" || typeof title !== "string") {
    throw new GithubApiError("GitHub returned a malformed pull request.", 0);
  }
  const head = asRecord(rec?.head);
  const base = asRecord(rec?.base);
  const user = asRecord(rec?.user);
  return {
    number,
    title,
    state: typeof rec?.state === "string" ? rec.state : "unknown",
    draft: rec?.draft === true,
    head: typeof head?.ref === "string" ? head.ref : "",
    base: typeof base?.ref === "string" ? base.ref : "",
    htmlUrl: typeof rec?.html_url === "string" ? rec.html_url : "",
    author: typeof user?.login === "string" ? user.login : "",
    createdAt: typeof rec?.created_at === "string" ? rec.created_at : ""
  };
}
function parseIssue(raw) {
  const rec = asRecord(raw);
  const number = rec?.number;
  const title = rec?.title;
  if (typeof number !== "number" || typeof title !== "string") {
    throw new GithubApiError("GitHub returned a malformed issue.", 0);
  }
  const user = asRecord(rec?.user);
  const labels = Array.isArray(rec?.labels) ? rec.labels.map((l) => {
    const lr = asRecord(l);
    return typeof lr?.name === "string" ? lr.name : null;
  }).filter((l) => l !== null) : [];
  return {
    number,
    title,
    state: typeof rec?.state === "string" ? rec.state : "unknown",
    htmlUrl: typeof rec?.html_url === "string" ? rec.html_url : "",
    author: typeof user?.login === "string" ? user.login : "",
    labels,
    createdAt: typeof rec?.created_at === "string" ? rec.created_at : "",
    isPullRequest: rec?.pull_request !== void 0
  };
}
export {
  asRecord,
  parseIssue,
  parsePullRequest,
  readErrorMessage
};
