import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, relative, dirname, join } from 'node:path'

// Explicit source checkout only. This copies domain implementations, never
// the standalone Agent bootstrap, model process, credentials or user state.
const source = process.argv[2]
if (!source) throw new Error('Usage: node port-agent-domains.mjs /absolute/agent/src')
const base = resolve(source)
const entries = [
  'tools/os/index.ts', 'tools/tool-registry.ts', 'tools/unknown-argument-guard.ts',
  'tools/read-scope/confine-reads.ts', 'tools/control-marker-guard.ts',
  'approval/read-scope-grants.ts', 'prompt/tool-descriptors.ts', 'config/config-schema.ts',
  'tools/github/index.ts', 'tools/verify/index.ts', 'tools/os/screen/index.ts',
  'memory/reflection/reflection-runner.ts', 'memory/retrieve/index.ts',
  'memory/memory-context-provider.ts', 'memory/consolidator/index.ts',
  'memory/profile-renderer.ts',
]
const result = await build({ entryPoints: entries.map(file => join(base, file)),
  bundle: true, outdir: '/unused', packages: 'external', platform: 'node',
  format: 'esm', write: false, metafile: true })
const files = Object.keys(result.metafile.inputs)
for (const input of files) {
  const path = resolve(input)
  const name = relative(base, path)
  if (name.startsWith('..') || /(?:^|\/)(?:bootstrap|agent-loop)\.(?:ts|js)$/.test(name)) throw new Error(`Non-domain dependency: ${name}`)
  const target = join('scripts/personal-agent-tools/agent-source/suite', name)
  await mkdir(dirname(target), { recursive: true })
  let text = await readFile(path, 'utf8')
  text = text.replace(/(["'])(\.\.?\/[^"']+)\.js\1/g, (_, quote, name) => quote + name + '.mjs' + quote)
  // Keep the existing audited Personal adaptation for this one formatter.
  // Its defaults and validation match upstream, but it never loads Agent config.
  if (name === 'tools/os/shell/shell-result.ts') {
    text = text.replace('import { getConfig } from "../../../config/index.mjs";', 'import { ENV_DEFAULTS } from "../../../config/config-schema.mjs";')
    text = text.replace('getConfig().agent;', 'personalShellResultOptions;')
    text += `
// Chat owns these explicit settings; preserve source defaults and bounds.
let personalShellResultOptions = { shellToolResultCharCap: ENV_DEFAULTS.SHELL_TOOL_RESULT_CHAR_CAP, shellToolResultTailLines: ENV_DEFAULTS.SHELL_TOOL_RESULT_TAIL_LINES };
export function configurePersonalShellResultOptions(options: typeof personalShellResultOptions): void {
  if (!Number.isInteger(options.shellToolResultCharCap) || options.shellToolResultCharCap < 400 || options.shellToolResultCharCap > 1000000 || !Number.isInteger(options.shellToolResultTailLines) || options.shellToolResultTailLines < 12 || options.shellToolResultTailLines > 100000) throw new Error("Invalid Personal shell result limits");
  personalShellResultOptions = { ...options };
}
`;
  }
  if (name === 'tools/os/archive/archive-resolver.ts') {
    text = 'import { PERSONAL_ARCHIVE_INPUT_BYTES } from "./archive-budget.mjs";\n' + text
    text = text.replace('  const data = await readFile(absolute);', '  if (info.size > PERSONAL_ARCHIVE_INPUT_BYTES) throw new Error("Archive input exceeds the Personal byte budget");\n  const data = await readFile(absolute);')
  }
  if (name === 'tools/os/archive/zip-backend.ts') {
    text = 'import { validateZipDirectory, boundedZipRead } from "./archive-budget.mjs";\n' + text
    text = text.replaceAll('    const zip = await JSZip.loadAsync(data);', '    validateZipDirectory(data);\n    const zip = await JSZip.loadAsync(data);')
    text = text.replaceAll('(await file.async("string")).trim()', '(await boundedZipRead(file, 65536)).toString("utf8").trim()')
    text = text.replaceAll('await file.async("nodebuffer")', 'await boundedZipRead(file)')
  }
  if (name === 'tools/os/archive/tar-backend.ts') {
    text = 'import { collectBounded } from "./archive-budget.mjs";\n' + text
    text = text.replace(/const chunks: Buffer\[\] = \[\];\s*for await \(const chunk of stream\) chunks.push\(chunk as Buffer\);\s*(found|const body) = Buffer.concat\(chunks\);/g,
      (_match, target) => target + ' = await collectBounded(stream);')
  }
  if (name === 'tools/os/archive/gz-backend.ts') text = text.replaceAll('gunzipSync(data)', 'gunzipSync(data, { maxOutputLength: 10 * 1024 * 1024 })')
  await writeFile(target, text)
}
console.log(`Copied ${files.length} domain modules from the pinned source checkout.`)
