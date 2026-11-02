function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
const pathArg = (args) => {
  const path = nonEmpty(args.path);
  return path === void 0 ? [] : [path];
};
const READ_TOOL_TARGETS = /* @__PURE__ */ new Map([
  ["os.fs.read", pathArg],
  ["os.fs.list", pathArg],
  ["os.fs.hash", pathArg],
  ["os.fs.watch", pathArg],
  ["os.fs.read_document", pathArg],
  ["os.fs.archive.list", pathArg],
  ["os.fs.archive.read_entry", pathArg],
  ["os.fs.grep", pathArg],
  [
    "os.fs.glob",
    // `cwd` wins over `path` inside the tool; either names the root.
    (args) => {
      const root = nonEmpty(args.cwd) ?? nonEmpty(args.path);
      return root === void 0 ? [] : [root];
    }
  ],
  [
    "os.fs.diff",
    (args) => [nonEmpty(args.aPath), nonEmpty(args.bPath)].filter(
      (path) => path !== void 0
    )
  ],
  [
    "vision.describe",
    (args) => [
      nonEmpty(args.path),
      ...Array.isArray(args.paths) ? args.paths.map(nonEmpty) : []
    ].filter((path) => path !== void 0)
  ],
  [
    // The first frame of an image-to-video clip: Core reads the file and
    // sends it to OpenRouter, so it is scoped like any read.
    "video.generate",
    (args) => {
      const image = nonEmpty(args.image);
      return image === void 0 ? [] : [image];
    }
  ],
  [
    // Not a read, but a way to one: a file moved from outside the scope
    // into the working directory could then be read without asking. Its
    // sources are checked like reads; destinations are writes, which the
    // approval ladder classifies.
    "os.fs.move",
    (args) => (Array.isArray(args.moves) ? args.moves : [args]).map(
      (item) => typeof item === "object" && item !== null ? nonEmpty(item.from) : void 0
    ).filter((path) => path !== void 0)
  ],
  [
    // A syntax check reads every file it is handed.
    "verify.syntax",
    (args) => (Array.isArray(args.files) ? args.files.map(nonEmpty) : []).filter(
      (path) => path !== void 0
    )
  ]
]);
const SHELL_TOOL = "os.shell.run";
const URL_LIKE = /^[a-z][a-z0-9+.-]*:(?:\/\/|[^\\/])/i;
export {
  READ_TOOL_TARGETS,
  SHELL_TOOL,
  URL_LIKE
};
