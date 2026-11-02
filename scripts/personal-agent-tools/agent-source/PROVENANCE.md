# Atomic Agent source port

Selected syntax verification modules from AtomicBot-ai/atomic-agent, revision
`fdc7813cb1b2d7a72781c957b211e03af5e02130` (0.6.13), MIT, copyright 2026 Atomic Bot.
The license is retained in LICENSE.

These are local Chat sources, not a dependency on the Agent executable.
Import paths are local; the standalone tool-registry wrapper is omitted because
Chat owns discovery, input validation and approvals. Only the parsing portion of
fs-parse-check is included; write-result decoration is not used by syntax checks.
The SEA runtime check uses Node's built-in node:sea directly. Existing comments
and checker semantics are retained. Generated mjs files are rebuilt by
`node scripts/personal-agent-tools/build-agent-source.mjs`.

Additional copied domains: `src/tasks/task-schedule.ts` and `task-types.ts`;
`src/memory/memory-store.ts`, `memory-schema.ts`, embedding client/hybrid ranking
helpers and the native SQLite loader; `src/tools/os/read-document/extractors/`
(non-test modules). Relative runtime import extensions are adapted to `.mjs`.
The memory store's optional embedding code is retained but no embedding daemon
is started or configured. Document extractors are called through Chat's bounded
workspace adapter. The standalone Agent loop is not loaded.

Profile history/eviction/name-key helpers, link graph, lesson and procedure stores
are also copied from the same revision. Chat adapts these through
`personal_knowledge`; original append-only bodies and history/deprecation rules
remain. This is explicit storage integration, not automatic reflection or
consolidation parity.

The `suite/` tree contains 369 transitive domain-source modules selected from
`tools/os/index.ts`, the tool registry, argument/control-marker guards, read-scope
guards, and their schema/configuration types. The native adapter uses the original
registry, masking, coercion, read boundaries and mutation approval requests.
It never boots the standalone runtime or reads its private state/configuration.
The shell result renderer's only configuration lookup is adapted to explicit
Personal settings with the same upstream default limits and validation bounds.
No inference loop or model startup entry point is reused.

`git-status-parser.ts` retains the original NUL-safe status parser and interface,
without the standalone registry wrapper. Generated `.mjs` files correspond to the
adjacent TypeScript sources. Source comments and licensing are retained.

The same pinned source now includes GitHub, copy-workspace verification, optional
screen tools and reflection/retrieval/consolidation domain modules. Only grounded
reflection is lifecycle-connected; copying a domain is not activation or parity.
Chat supplies mail configuration explicitly. Personal archive adaptations bound
allocation before inflation and retain original path/approval checks.

2026-11-02 continuation: `memory/embeddings/embedding-store.ts` and
`embedding-writer.ts` copied from the same pinned local Atomic Agent reference
checkout. Only relative `.js` import suffixes become `.mjs`; runtime files are
transpiled with the existing esbuild dependency. Original comments are retained.
Link-generator runner/prompt/parser/grammar/response-format are copied from the
same source reference. Store imports point at the already ported shared
`agent-source/memory/links/link-store` so validation error identity and SQLite
ownership stay consistent. Chat retains idle scheduling and abort ownership.
