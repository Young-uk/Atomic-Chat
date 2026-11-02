import { OS_FS_READ_CONTRACT } from "../tools/os/fs/fs-read-contract.mjs";
import { OS_FS_LIST_CONTRACT } from "../tools/os/fs/fs-list-contract.mjs";
import { OS_FS_GLOB_CONTRACT } from "../tools/os/fs/fs-glob-contract.mjs";
import { OS_FS_GREP_CONTRACT } from "../tools/os/fs/fs-grep-contract.mjs";
import { OS_FS_DIFF_CONTRACT } from "../tools/os/fs/fs-diff-contract.mjs";
import { OS_FS_WATCH_CONTRACT } from "../tools/os/fs/fs-watch-contract.mjs";
import { OS_FS_WRITE_CONTRACT } from "../tools/os/fs/fs-write-contract.mjs";
import { OS_FS_EDIT_CONTRACT } from "../tools/os/fs/fs-edit-contract.mjs";
import { OS_FS_PATCH_CONTRACT } from "../tools/os/fs/fs-patch-contract.mjs";
import { OS_FS_TRASH_CONTRACT } from "../tools/os/fs/fs-trash-contract.mjs";
import { OS_FS_RESTORE_CONTRACT } from "../tools/os/fs/fs-restore-contract.mjs";
import { OS_FS_MOVE_CONTRACT } from "../tools/os/fs/fs-move-contract.mjs";
import { OS_FS_LOCATE_PROJECT_CONTRACT } from "../tools/os/fs/fs-locate-project-contract.mjs";
import { OS_FS_HASH_CONTRACT } from "../tools/os/fs/fs-hash-contract.mjs";
import { DOCUMENT_FORMATS } from "../tools/os/read-document/extractors/extractor-types.mjs";
import { GITHUB_TOOL_ARGS_SCHEMAS } from "./github-tool-args-schemas.mjs";
import { SCREEN_TOOL_ARGS_SCHEMAS } from "./screen-tool-args-schemas.mjs";
const stringSchema = { type: "string" };
const stringArraySchema = {
  type: "array",
  items: { type: "string" }
};
const numberSchema = { type: "number" };
const integerSchema = { type: "integer" };
const booleanSchema = { type: "boolean" };
function obj(properties, required = []) {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false
  };
}
function objOpen(properties) {
  return {
    type: "object",
    properties,
    additionalProperties: true
  };
}
const DEFAULT_TOOL_ARGS_SCHEMAS = new Map([
  // ── browser ──────────────────────────────────────────────────────────────
  ["browser.navigate", obj({ url: stringSchema }, ["url"])],
  ["browser.click", obj({ ref: stringSchema }, ["ref"])],
  [
    "browser.type",
    obj(
      {
        ref: stringSchema,
        text: stringSchema,
        pressEnter: booleanSchema
      },
      ["ref", "text"]
    )
  ],
  [
    "browser.read_aria",
    obj({
      mode: { type: "string", enum: ["full", "interactive", "diff", "region"] },
      ref: stringSchema
    })
  ],
  [
    "browser.search",
    obj({ query: stringSchema, engine: stringSchema }, ["query"])
  ],
  [
    "browser.tabs",
    obj(
      {
        action: { type: "string", enum: ["list", "switch", "close", "new"] },
        index: integerSchema,
        url: stringSchema
      },
      ["action"]
    )
  ],
  ["browser.screenshot", obj({ ref: stringSchema, fullPage: booleanSchema })],
  [
    "browser.scroll",
    obj(
      {
        direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
        amount: {
          anyOf: [
            { type: "string", enum: ["page", "half"] },
            { type: "number" }
          ]
        }
      },
      ["direction"]
    )
  ],
  // ── os.shell ─────────────────────────────────────────────────────────────
  [
    "os.shell.run",
    // Four forms share one schema: `{cmd, args, …}` runs a command;
    // `{wait}`, `{kill}` and `{jobs}` act on a job the default timeout
    // detached (F47). Nothing is required at the schema level because
    // each form requires a different key; the tool refuses a call that
    // mixes them or names none.
    obj({
      cmd: stringSchema,
      args: stringArraySchema,
      cwd: stringSchema,
      timeoutMs: numberSchema,
      keep: booleanSchema,
      background: booleanSchema,
      wait: integerSchema,
      kill: integerSchema,
      jobs: booleanSchema
    })
  ],
  // ── os.fs ────────────────────────────────────────────────────────────────
  [OS_FS_READ_CONTRACT.name, OS_FS_READ_CONTRACT.argsJsonSchema],
  [OS_FS_WRITE_CONTRACT.name, OS_FS_WRITE_CONTRACT.argsJsonSchema],
  [OS_FS_RESTORE_CONTRACT.name, OS_FS_RESTORE_CONTRACT.argsJsonSchema],
  [OS_FS_MOVE_CONTRACT.name, OS_FS_MOVE_CONTRACT.argsJsonSchema],
  [OS_FS_TRASH_CONTRACT.name, OS_FS_TRASH_CONTRACT.argsJsonSchema],
  [OS_FS_LIST_CONTRACT.name, OS_FS_LIST_CONTRACT.argsJsonSchema],
  [OS_FS_GLOB_CONTRACT.name, OS_FS_GLOB_CONTRACT.argsJsonSchema],
  [OS_FS_LOCATE_PROJECT_CONTRACT.name, OS_FS_LOCATE_PROJECT_CONTRACT.argsJsonSchema],
  [OS_FS_GREP_CONTRACT.name, OS_FS_GREP_CONTRACT.argsJsonSchema],
  [OS_FS_EDIT_CONTRACT.name, OS_FS_EDIT_CONTRACT.argsJsonSchema],
  [
    "os.fs.read_document",
    obj(
      {
        path: stringSchema,
        // Closed set, per the "enums match the runtime validators verbatim"
        // convention above: `detectFormat` accepts exactly DOCUMENT_FORMATS
        // and rejects anything else. Leaving it an open string is what let
        // models emit the invented `format: "text"` (issue #113).
        format: { type: "string", enum: [...DOCUMENT_FORMATS] },
        maxBytes: numberSchema,
        maxPages: numberSchema,
        pagesFrom: numberSchema,
        pagesTo: numberSchema,
        sheets: {
          type: "array",
          items: { anyOf: [stringSchema, numberSchema] }
        },
        pageSeparators: booleanSchema,
        includeTables: booleanSchema
      },
      ["path"]
    )
  ],
  [
    "os.fs.archive.list",
    obj(
      {
        path: stringSchema,
        format: { type: "string", enum: ["zip", "tar", "tar.gz", "gz"] }
      },
      ["path"]
    )
  ],
  [
    "os.fs.archive.read_entry",
    obj(
      {
        path: stringSchema,
        entry: stringSchema,
        as: { type: "string", enum: ["utf8", "base64"] },
        maxBytes: numberSchema,
        format: { type: "string", enum: ["zip", "tar", "tar.gz", "gz"] }
      },
      ["path", "entry"]
    )
  ],
  [
    "os.fs.archive.extract",
    obj(
      {
        path: stringSchema,
        destDir: stringSchema,
        overwrite: booleanSchema,
        followSymlinks: booleanSchema,
        include: stringArraySchema,
        limits: objOpen({
          maxTotalBytes: numberSchema,
          maxEntryBytes: numberSchema,
          maxEntries: numberSchema
        }),
        format: { type: "string", enum: ["zip", "tar", "tar.gz", "gz"] }
      },
      ["path", "destDir"]
    )
  ],
  [OS_FS_HASH_CONTRACT.name, OS_FS_HASH_CONTRACT.argsJsonSchema],
  [OS_FS_DIFF_CONTRACT.name, OS_FS_DIFF_CONTRACT.argsJsonSchema],
  [OS_FS_PATCH_CONTRACT.name, OS_FS_PATCH_CONTRACT.argsJsonSchema],
  [OS_FS_WATCH_CONTRACT.name, OS_FS_WATCH_CONTRACT.argsJsonSchema],
  // ── os.git ───────────────────────────────────────────────────────────────
  ["os.git.status", obj({ repo: stringSchema })],
  [
    "os.git.log",
    obj({
      repo: stringSchema,
      limit: numberSchema,
      revisionRange: stringSchema,
      path: stringSchema
    })
  ],
  [
    "os.git.diff",
    obj({
      repo: stringSchema,
      revisionRange: stringSchema,
      staged: booleanSchema,
      paths: stringArraySchema,
      context: numberSchema
    })
  ],
  [
    "os.git.show",
    obj({
      repo: stringSchema,
      revision: stringSchema,
      patch: booleanSchema
    })
  ],
  [
    "os.git.blame",
    obj(
      {
        repo: stringSchema,
        path: stringSchema,
        revision: stringSchema,
        startLine: numberSchema,
        endLine: numberSchema
      },
      ["path"]
    )
  ],
  [
    "os.git.branch",
    obj({
      repo: stringSchema,
      includeRemote: booleanSchema,
      contains: stringSchema,
      pattern: stringSchema
    })
  ],
  [
    "os.git.init",
    obj({
      path: stringSchema,
      initialBranch: stringSchema,
      userName: stringSchema,
      userEmail: stringSchema
    })
  ],
  [
    "os.git.add",
    obj({
      repo: stringSchema,
      paths: stringArraySchema,
      all: booleanSchema,
      unstage: booleanSchema
    })
  ],
  [
    "os.git.remote",
    obj({
      repo: stringSchema,
      action: { type: "string", enum: ["list", "add", "set-url", "remove"] },
      name: stringSchema,
      url: stringSchema
    })
  ],
  [
    "os.git.fetch",
    obj({
      repo: stringSchema,
      remote: stringSchema,
      all: booleanSchema,
      prune: booleanSchema
    })
  ],
  [
    "os.git.pull",
    obj({
      repo: stringSchema,
      remote: stringSchema,
      branch: stringSchema,
      rebase: booleanSchema
    })
  ],
  [
    "os.git.clone",
    obj(
      {
        url: stringSchema,
        dest: stringSchema,
        branch: stringSchema,
        depth: numberSchema
      },
      ["url"]
    )
  ],
  ...GITHUB_TOOL_ARGS_SCHEMAS,
  // ── os.proc ──────────────────────────────────────────────────────────────
  ["os.proc.list", obj({ filter: stringSchema, limit: numberSchema })],
  [
    "os.proc.kill",
    obj(
      {
        pid: numberSchema,
        signal: {
          type: "string",
          enum: ["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]
        }
      },
      ["pid"]
    )
  ],
  // ── os.http ──────────────────────────────────────────────────────────────
  [
    "os.http.request",
    obj(
      {
        url: stringSchema,
        method: { type: "string", enum: ["GET", "POST"] },
        headers: {
          type: "object",
          additionalProperties: { type: "string" }
        },
        body: {
          anyOf: [{ type: "string" }, { type: "object" }]
        },
        timeoutMs: numberSchema,
        followRedirects: booleanSchema
      },
      ["url"]
    )
  ],
  // ── os.web ───────────────────────────────────────────────────────────────
  [
    "os.web.search",
    obj(
      {
        query: stringSchema,
        maxResults: numberSchema
      },
      ["query"]
    )
  ],
  [
    "os.web.fetch",
    obj(
      {
        url: stringSchema,
        extractMode: { type: "string", enum: ["markdown", "text"] },
        maxChars: numberSchema,
        timeoutMs: numberSchema
      },
      ["url"]
    )
  ],
  // ── os.clipboard / os.window / os.notify ─────────────────────────────────
  ["os.clipboard.read", obj({})],
  ["os.clipboard.write", obj({ value: stringSchema }, ["value"])],
  ["os.window.list", obj({})],
  ["os.window.focus", obj({ title: stringSchema }, ["title"])],
  [
    "os.notify",
    obj({ title: stringSchema, message: stringSchema, sound: booleanSchema }, [
      "title",
      "message"
    ])
  ],
  ["os.email.inbox", obj({ limit: numberSchema })],
  [
    "os.email.send",
    obj({ to: stringSchema, subject: stringSchema, text: stringSchema }, [
      "to",
      "subject",
      "text"
    ])
  ],
  ...SCREEN_TOOL_ARGS_SCHEMAS,
  // ── skill / tool ─────────────────────────────────────────────────────────
  ["skill.view", obj({ name: stringSchema }, ["name"])],
  ["tool.view", obj({ name: stringSchema }, ["name"])],
  [
    "skill.run_script",
    obj(
      {
        skill: stringSchema,
        script: stringSchema,
        args: stringArraySchema,
        timeoutMs: numberSchema
      },
      ["skill", "script"]
    )
  ],
  // ── memory.profile ───────────────────────────────────────────────────────
  [
    "memory.profile.set",
    obj(
      {
        key: stringSchema,
        value: stringSchema,
        pinned: booleanSchema,
        keywords: stringArraySchema
      },
      ["key", "value"]
    )
  ],
  ["memory.profile.remove", obj({ key: stringSchema }, ["key"])],
  ["memory.profile.list", obj({})],
  ["memory.profile.history", obj({ key: stringSchema }, ["key"])],
  // ── memory.notes ─────────────────────────────────────────────────────────
  [
    "memory.notes.store",
    obj({ content: stringSchema, tags: stringArraySchema }, ["content"])
  ],
  [
    "memory.notes.recall",
    obj({
      query: stringSchema,
      id: numberSchema,
      k: numberSchema,
      scope: { type: "string", enum: ["project", "all"] },
      tags: stringArraySchema
    })
  ],
  ["memory.notes.forget", obj({ id: numberSchema }, ["id"])],
  // ── memory.lessons / memory.procedures ───────────────────────────────────
  [
    "memory.lessons.recall",
    obj({ id: numberSchema, query: stringSchema, k: numberSchema })
  ],
  [
    "memory.procedures.recall",
    obj({ id: numberSchema, query: stringSchema, k: numberSchema })
  ],
  // ── tasks ────────────────────────────────────────────────────────────────
  [
    "tasks.schedule",
    obj(
      {
        userMessage: stringSchema,
        at: numberSchema,
        inSeconds: numberSchema,
        newSession: booleanSchema,
        notify: { type: "string", enum: ["telegram"] }
      },
      ["userMessage"]
    )
  ],
  [
    "tasks.cron",
    obj(
      {
        userMessage: stringSchema,
        expression: stringSchema,
        tz: stringSchema,
        notify: { type: "string", enum: ["telegram"] }
      },
      ["userMessage", "expression"]
    )
  ],
  [
    "tasks.list",
    obj({
      status: stringSchema,
      sessionId: stringSchema,
      limit: numberSchema
    })
  ],
  ["tasks.cancel", obj({ id: stringSchema }, ["id"])],
  ["tasks.show", obj({ id: stringSchema }, ["id"])],
  // ── vision ───────────────────────────────────────────────────────────────
  [
    "vision.describe",
    obj(
      {
        prompt: stringSchema,
        path: stringSchema,
        // `maxItems` mirrors the DEFAULT of `config.vision.maxImagesPerCall`
        // (4). The runtime check in `buildVisionDescribeTool` reads the live
        // config and stays authoritative; this bound is a hint so cloud
        // providers and grammar-constrained decoding stop the model from
        // emitting a 20-image call it can only discover is invalid by failing.
        paths: { ...stringArraySchema, maxItems: 4 }
      },
      ["prompt"]
    )
  ],
  // ── image ────────────────────────────────────────────────────────────────
  // Plain types only, so the schema stays strict-convertible: the tool's
  // parser owns the 1..4 count bound and the size vocabulary.
  [
    "image.generate",
    obj(
      {
        prompt: stringSchema,
        size: stringSchema,
        count: integerSchema,
        seed: integerSchema,
        model: stringSchema
      },
      ["prompt"]
    )
  ],
  // ── video ────────────────────────────────────────────────────────────────
  // Plain types only, like image: the tool's parser owns the duration
  // bound and the aspect/resolution vocabularies.
  [
    "video.generate",
    obj(
      {
        prompt: stringSchema,
        image: stringSchema,
        duration: integerSchema,
        aspect: stringSchema,
        resolution: stringSchema,
        audio: booleanSchema,
        seed: integerSchema,
        model: stringSchema
      },
      ["prompt"]
    )
  ],
  // ── mcp aggregates ───────────────────────────────────────────────────────
  [
    "mcp.resource.list",
    obj({ server: stringSchema, limit: numberSchema }, ["server"])
  ],
  [
    "mcp.resource.read",
    obj({ server: stringSchema, uri: stringSchema }, ["server", "uri"])
  ],
  [
    "mcp.prompt.list",
    obj({ server: stringSchema, limit: numberSchema }, ["server"])
  ],
  [
    "mcp.prompt.get",
    obj(
      {
        server: stringSchema,
        name: stringSchema,
        arguments: {
          type: "object",
          additionalProperties: { type: "string" }
        }
      },
      ["server", "name"]
    )
  ],
  // ── fusion fan-out ───────────────────────────────────────────────────────
  [
    "fusion.delegate",
    obj(
      {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: obj(
            {
              id: stringSchema,
              // Optional since F44: the tool defaults it to the id.
              title: stringSchema,
              instructions: stringSchema,
              deliverable: stringSchema,
              files: { ...stringArraySchema, maxItems: 32 },
              // Per-task budgets. No upper bound here: the runner
              // clamps them to a multiple of the configured default and
              // says so in the result, because a number too big is the
              // planner's estimate of the work, not a malformed call.
              maxSteps: { type: "integer", minimum: 1 },
              timeoutMs: { type: "integer", minimum: 1 }
            },
            ["id", "instructions"]
          )
        },
        // No upper bound: the orchestrator sizes its own fan-out and
        // the tool bounds the number by the task count and the server's
        // request slots. See `delegate-args.ts`.
        maxWorkers: { type: "integer", minimum: 1 },
        // The interface between the parts (`contract.ts`). `checks`
        // items are `verify.run` specs plus a `task`, so they stay open.
        contract: obj({
          // F51: the operator's own files; workers edit them in place.
          inputs: { ...stringArraySchema, maxItems: 32 },
          owners: {
            type: "object",
            additionalProperties: { type: "string" }
          },
          provides: {
            type: "array",
            maxItems: 64,
            items: obj(
              {
                task: stringSchema,
                kind: {
                  type: "string",
                  enum: [
                    "symbol",
                    "file",
                    "id",
                    "endpoint",
                    "env",
                    "flag",
                    "other"
                  ]
                },
                name: stringSchema,
                in: stringSchema,
                // What it IS, in one line — a signature or return shape.
                // Names match without meanings matching; this is the
                // only part of a provide that carries semantics.
                shape: stringSchema
              },
              ["task", "kind", "name"]
            )
          },
          requires: {
            type: "array",
            items: obj({ task: stringSchema, name: stringSchema }, [
              "task",
              "name"
            ])
          },
          checks: {
            type: "array",
            maxItems: 16,
            items: objOpen({ task: stringSchema })
          }
        })
      },
      ["tasks"]
    )
  ],
  ["verify.syntax", obj({ files: stringArraySchema }, ["files"])],
  [
    "verify.run",
    obj(
      {
        kind: { type: "string", enum: ["command", "service", "page"] },
        cwd: stringSchema,
        // A map of arbitrary keys, like `os.http.request.headers`; the
        // strict converter refuses it, knowingly.
        env: { type: "object", additionalProperties: { type: "string" } },
        timeoutMs: numberSchema,
        network: booleanSchema,
        cmd: stringSchema,
        args: stringArraySchema,
        start: obj({ cmd: stringSchema, args: stringArraySchema }, ["cmd"]),
        ready: obj({ port: integerSchema, url: stringSchema, timeoutMs: numberSchema }),
        requests: {
          type: "array",
          items: obj({
            method: stringSchema,
            path: stringSchema,
            url: stringSchema,
            body: stringSchema,
            expectStatus: integerSchema,
            expectBody: stringSchema
          })
        },
        path: stringSchema,
        url: stringSchema,
        script: {
          type: "array",
          items: obj(
            {
              action: { type: "string", enum: ["click", "key", "type", "wait"] },
              selector: stringSchema,
              key: stringSchema,
              text: stringSchema,
              ms: numberSchema
            },
            ["action"]
          )
        },
        seconds: numberSchema,
        probes: {
          type: "array",
          items: obj({ name: stringSchema, expr: stringSchema }, ["name", "expr"])
        },
        checks: stringArraySchema
      },
      ["kind"]
    )
  ],
  // ── terminal verbs ───────────────────────────────────────────────────────
  // The OpenAI adapter overrides these with hand-tuned schemas (see
  // `descriptorToJsonSchema` in openai-tool-call-adapter.ts), but we
  // keep entries here so the "every default tool ships a schema" pin
  // test stays exhaustive.
  [
    "reply",
    obj({ text: stringSchema, attachments: stringArraySchema }, ["text"])
  ],
  ["finish", obj({ summary: stringSchema, text: stringSchema })]
]);
function getDefaultArgsJsonSchema(name) {
  return DEFAULT_TOOL_ARGS_SCHEMAS.get(name);
}
function attachDefaultArgsJsonSchema(descriptor) {
  if (descriptor.argsJsonSchema) return descriptor;
  const schema = DEFAULT_TOOL_ARGS_SCHEMAS.get(descriptor.name);
  if (!schema) return descriptor;
  return { ...descriptor, argsJsonSchema: schema };
}
export {
  attachDefaultArgsJsonSchema,
  getDefaultArgsJsonSchema
};
