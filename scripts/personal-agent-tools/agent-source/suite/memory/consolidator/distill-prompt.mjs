const DISTILL_PROMPT_PREFIX = `You distill clusters of agent episodes into one durable lesson.

Output exactly one line of the form:

  LESSON activation="<when this lesson applies>"; principle="<1..3 sentences of durable advice>"; tags=<3..6 lowercase identifiers>

# Doctrine

## activation \u2014 an observable signal, not a paraphrased request

Activation describes the **observable signal that should fire this
lesson** \u2014 one of:
  (a) a stable property of the user / repo / data / environment, or
  (b) a recurring pattern ("user has repeatedly asked for X"), or
  (c) a failure mode visible in the cluster ("pre-commit fails on Y").

It is **not** a reactive paraphrase of a hypothetical user question.

  BAD : "When the user asks about Node version"
  GOOD: "this repo pins Node 20 via .nvmrc; native modules involved"

  BAD : "When the user wants concise answers"
  GOOD: "user has repeatedly asked for shorter responses in this session"

  BAD : "When working with JSON"
  GOOD: "parsing JSON that contains snowflake / int64 / very large numeric ids"

  BAD : "vendor/ directory contents are scanned by eslint"   (state-only, omits the failure)
  GOOD: "pre-commit lint hook fails on vendor / third-party files"

## principle \u2014 carry over named tools, files, commands

If the episodes mention concrete identifiers (\`.nvmrc\`, \`BigInt\`,
\`.eslintignore\`, \`bin/deploy.sh\`, \`nvm use 20\`, error message
strings) the principle **must** carry them through verbatim. A
principle that generalises away the identifiers is too vague to be
actionable.

  BAD : "Match runtime versions between local and CI to avoid silent failures."
  GOOD: "Repo is hard-pinned to Node 20; native modules (better-sqlite3, ...) rebuild against the local ABI. Always \`nvm use 20\` before touching dependencies; changing the pin requires an ADR."

Principle is 1..3 sentences, strictly observational, no first-person
pronouns ("I", "we", "my", "our").

## tags \u2014 3..6 lowercase identifiers spanning concrete dimensions

Pick tags from at least three of the following dimensions:

  - technology  : node, eslint, typescript, json, sqlite, playwright
  - tool/file   : nvmrc, eslintignore, bigint, deploy-script
  - domain      : ci, lint, parse, deploy, security
  - topic anchor: vendor, precommit, snowflake, native-modules

Each tag is a **single concept word** in lowercase ASCII, no longer
than 24 characters. Multi-word concepts use a hyphen (\`native-modules\`,
not \`native_modules\`). Pick 3..6 tags; fewer than 3 is too sparse to
be useful for recall, and never join multiple concepts inside one
tag with separators.

  BAD : tags=lint_precommit_tool_file        (four concepts squashed)
  BAD : tags=ci_tooling_native-modules       (three concepts squashed)
  GOOD: tags=lint,precommit,eslint,vendor
  GOOD: tags=node,nvmrc,native-modules,ci

# Abstain

Do not invent rules unsupported by the input. If the cluster has no
durable lesson, emit the abstain sentinel (no tags):

  LESSON activation="(no consensus)"; principle="(no durable advice)"
`;
const DISTILL_PROCEDURE_DOCTRINE = `
# Optional second line: PROCEDURE

If \u2014 and only if \u2014 the cluster shows a **repeated tool-call shape**
(at least 3 of the N episodes ran the same sequence of tools to
resolve the same kind of task), add a second line:

  PROCEDURE activation="<short trigger>"; steps="<step1>; <step2>; ..."[; tags=a,b,c]

Rules:
  - 2..8 steps separated by \`; \`. Each step is one short imperative
    clause; append \`@<tool-name>\` when the cluster used a specific
    tool for that step (e.g. \`glob TS files@os.fs.glob\`).
  - If the cluster is conceptually related but procedurally
    divergent (each episode used a different tool sequence), do
    **not** emit a PROCEDURE line at all \u2014 drop it entirely.
  - Procedure activation describes the same trigger as the lesson
    activation but framed as a how-to ("when you need to do X").
  - The procedure is **advisory text** the next agent reads \u2014 it
    is never auto-executed. Steps that include \`@tool\` are hints
    for the agent, not commands for the runtime.

Examples:

  PROCEDURE activation="extract exported function signatures from a TypeScript file"; steps="glob \`**/*.ts\`@os.fs.glob; grep \`^export (async )?function\`@os.fs.grep; reply with file:line list@reply"
`;
const DISTILL_CONTENT_PREVIEW_CAP = 400;
const DISTILL_TAGS_PREVIEW_CAP = 6;
function buildDistillPrompt(input) {
  const lines = input.episodes.map((entry) => renderEpisodeLine(entry));
  const tagHint = input.sharedTags.length > 0 ? `Shared tags across the cluster: ${input.sharedTags.join(", ")}.
` : "";
  const segments = [DISTILL_PROMPT_PREFIX];
  if (input.withProcedure === true) {
    segments.push(DISTILL_PROCEDURE_DOCTRINE);
  }
  segments.push("", tagHint, "### cluster", ...lines, "", "### output", "");
  return segments.join("\n");
}
function renderEpisodeLine(entry) {
  const tagSegment = entry.tags.length > 0 ? ` [${entry.tags.slice(0, DISTILL_TAGS_PREVIEW_CAP).join(",")}]` : "";
  return `#${entry.id}${tagSegment} ${previewContent(entry.content)}`;
}
function previewContent(raw) {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= DISTILL_CONTENT_PREVIEW_CAP) return collapsed;
  return `${collapsed.slice(0, DISTILL_CONTENT_PREVIEW_CAP)}\u2026`;
}
export {
  DISTILL_CONTENT_PREVIEW_CAP,
  DISTILL_PROCEDURE_DOCTRINE,
  DISTILL_PROMPT_PREFIX,
  DISTILL_TAGS_PREVIEW_CAP,
  buildDistillPrompt
};
