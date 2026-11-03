import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { copyRuntimePackages } from './runtime-packages.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// This installer only merges our own connector. It never replaces other
// connectors, models, conversation data, or the normal Agent installation.
const args = process.argv.slice(2)
if (args[0] !== '--install' || !args[1]) throw new Error('Usage: node install.mjs --install /absolute/path/to/node')
const node = resolve(args[1])
const source = dirname(fileURLToPath(import.meta.url))
// Check native ABI compatibility before modifying the installed worker. Yarn
// may run under a different Node than the independently packaged Personal Node.
await promisify(execFile)(node, ['--input-type=module', '-e', `import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(import.meta.url)}); const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close();`], { timeout: 30000 })
const target = join(homedir(), 'Library/Application Support/Atomic Chat Personal Tools')
await mkdir(join(target, 'node_modules'), { recursive: true, mode: 0o700 })
if (resolve(node) !== resolve(join(target, 'node'))) await cp(node, join(target, 'node'))
for (const name of ['server.mjs','store.mjs','browser.mjs','windows.mjs','watch.mjs','verify.mjs','notes.mjs','profile-links.mjs','documents.mjs','git.mjs','native-suite.mjs','native-approval.mjs','memory-lifecycle.mjs','semantic-memory.mjs','feature-settings.mjs']) await cp(join(source, name), join(target, name))
await cp(join(source, 'agent-source'), join(target, 'agent-source'), { recursive: true })
await copyRuntimePackages(['playwright-core', 'cron-parser', 'better-sqlite3', 'pdfjs-dist', 'mammoth', 'word-extractor', 'exceljs', 'jszip', 'fast-xml-parser', 'tar-stream', '@mozilla/readability', 'linkedom', 'html-to-text', 'turndown', 'undici', 'yaml', 'fuzzysort', 'grammy', 'chokidar', 'clipboardy', 'diff', 'marked', 'node-notifier'], join(target, 'node_modules'))
const configPath = join(homedir(), 'Library/Application Support/Atomic Chat/data/mcp_config.json')
const original = await readFile(configPath, 'utf8')
const config = JSON.parse(original)
const key = 'atomic-personal-tools'
config.mcpServers ??= {}
if (config.mcpServers[key] && config.mcpServers[key].command !== join(target, 'node')) throw new Error('A different connector already uses atomic-personal-tools; refusing to replace it')
const previous = config.mcpServers[key]
config.mcpServers[key] = {
  command: join(target, 'node'), args: [join(target, 'server.mjs')],
  env: { ATOMIC_PERSONAL_TOOLS_DIR: join(target, 'data'), ATOMIC_PERSONAL_ENDPOINT: 'http://127.0.0.1:8010/v1', ATOMIC_PERSONAL_MODEL: 'qwen3.8-flash-next-chat', ATOMIC_PERSONAL_WORKSPACE: join(homedir(), 'Library/Application Support/Atomic Chat/data/agent-workspace'), ...previous?.env },
  type: 'stdio', active: previous?.active ?? false, timeout: previous?.timeout ?? 30,
}
await writeFile(join(target, `mcp-config-before-${Date.now()}.json`), original, { mode: 0o600, flag: 'wx' })
await writeFile(`${configPath}.personal.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 })
await rename(`${configPath}.personal.tmp`, configPath)
process.stdout.write('Personal tools installed. Existing connector activation, model settings and other connectors preserved. New connections remain disabled until enabled in Personal Chat.\n')
