import { parseBool, parseNonNegativeInt, parsePositiveInt } from "./config-primitives.mjs";
import { parseStringArrayOrNull } from "./config-values.mjs";
function createProjectsDefaults() {
  return {
    roots: []
  };
}
function parseProjectsConfig(raw, readDefaults) {
  return {
    roots: parseStringArrayOrNull(
      raw.roots ?? readDefaults().roots,
      "projects.roots"
    ) ?? []
  };
}
function createToolsDefaults() {
  return {
    shell: {
      // Ten minutes: long enough for an install or a test suite, short
      // enough that a runaway scan is reported the same hour it started.
      // The detach notice tells the model how to wait for or stop it.
      defaultTimeoutMs: 6e5,
      // An hour: a build or a download that has not finished by then is
      // not going to, and nobody is watching it any more.
      jobMaxMs: 36e5,
      // Three concurrent jobs is a server, a watcher and a build; more
      // is a model that has stopped waiting for anything.
      maxJobs: 3,
      // Only the two tokens the bundled skills read through the shell
      // (`gh` in `github`, `printenv` in `notion`), both pasted by the
      // operator for that purpose. Provider keys and bot tokens are not
      // here, so a command the model runs never sees them (ATO-347).
      envPassthrough: ["GITHUB_TOKEN", "NOTION_API_KEY"]
    },
    // Off until the operator asks for it: a model that can click and
    // type anywhere is not a default.
    screen: { enabled: false }
  };
}
function parseToolsConfig(raw, readDefaults, rawScreen = {}) {
  return {
    shell: {
      // Non-negative rather than positive: `0` is "no default", the
      // behaviour every pre-v67 file had.
      defaultTimeoutMs: parseNonNegativeInt(
        raw.defaultTimeoutMs ?? readDefaults().shell.defaultTimeoutMs,
        "tools.shell.defaultTimeoutMs"
      ),
      jobMaxMs: parsePositiveInt(
        raw.jobMaxMs ?? readDefaults().shell.jobMaxMs,
        "tools.shell.jobMaxMs"
      ),
      maxJobs: parsePositiveInt(
        raw.maxJobs ?? readDefaults().shell.maxJobs,
        "tools.shell.maxJobs"
      ),
      // A copy, so a caller mutating the parsed list cannot reach the
      // defaults. A file without the field (every pre-ATO-347 file)
      // takes the default.
      envPassthrough: [
        ...parseStringArrayOrNull(
          raw.envPassthrough ?? readDefaults().shell.envPassthrough,
          "tools.shell.envPassthrough"
        ) ?? []
      ]
    },
    screen: {
      enabled: parseBool(
        rawScreen.enabled ?? readDefaults().screen.enabled,
        "tools.screen.enabled"
      )
    }
  };
}
function createVisionDefaults() {
  return {
    enabled: true,
    autoDetect: true,
    maxImageBytes: 8 * 1024 * 1024,
    maxImagesPerCall: 4
  };
}
function parseVisionConfig(raw, readDefaults) {
  return {
    enabled: parseBool(
      raw.enabled ?? readDefaults().enabled,
      "vision.enabled"
    ),
    autoDetect: parseBool(
      raw.autoDetect ?? readDefaults().autoDetect,
      "vision.autoDetect"
    ),
    maxImageBytes: parsePositiveInt(
      raw.maxImageBytes ?? readDefaults().maxImageBytes,
      "vision.maxImageBytes"
    ),
    maxImagesPerCall: parsePositiveInt(
      raw.maxImagesPerCall ?? readDefaults().maxImagesPerCall,
      "vision.maxImagesPerCall"
    )
  };
}
export {
  createProjectsDefaults,
  createToolsDefaults,
  createVisionDefaults,
  parseProjectsConfig,
  parseToolsConfig,
  parseVisionConfig
};
