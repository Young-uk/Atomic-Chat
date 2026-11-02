const stringSchema = { type: "string" };
const stringArraySchema = { type: "array", items: { type: "string" } };
const numberSchema = { type: "number" };
const booleanSchema = { type: "boolean" };
const stateSchema = { type: "string", enum: ["open", "closed", "all"] };
function obj(properties, required = []) {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false
  };
}
const GITHUB_TOOL_ARGS_SCHEMAS = [
  [
    "os.git.checkout",
    obj(
      {
        branch: stringSchema,
        create: booleanSchema,
        startPoint: stringSchema,
        repo: stringSchema
      },
      ["branch"]
    )
  ],
  [
    "os.git.commit",
    obj(
      {
        message: stringSchema,
        paths: stringArraySchema,
        all: booleanSchema,
        repo: stringSchema
      },
      ["message"]
    )
  ],
  [
    "os.git.push",
    obj({
      remote: stringSchema,
      branch: stringSchema,
      setUpstream: booleanSchema,
      repo: stringSchema
    })
  ],
  // ── github ───────────────────────────────────────────────────────────────
  ["github.whoami", obj({})],
  [
    "github.pr.list",
    obj({
      repo: stringSchema,
      state: stateSchema,
      limit: numberSchema
    })
  ],
  [
    "github.pr.create",
    obj(
      {
        title: stringSchema,
        body: stringSchema,
        head: stringSchema,
        base: stringSchema,
        draft: booleanSchema,
        repo: stringSchema
      },
      ["title"]
    )
  ],
  [
    "github.issue.list",
    obj({
      repo: stringSchema,
      state: stateSchema,
      labels: stringArraySchema,
      limit: numberSchema
    })
  ],
  [
    "github.issue.create",
    obj(
      {
        title: stringSchema,
        body: stringSchema,
        labels: stringArraySchema,
        repo: stringSchema
      },
      ["title"]
    )
  ],
  [
    "github.issue.comment",
    obj(
      {
        number: numberSchema,
        body: stringSchema,
        repo: stringSchema
      },
      ["number", "body"]
    )
  ]
];
export {
  GITHUB_TOOL_ARGS_SCHEMAS
};
