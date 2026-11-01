import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// This installer only merges our own connector. It never replaces other
// connectors, models, conversation data, or the normal Agent installation.
const args = process.argv.slice(2)
if (args[0] !== '--install' || !args[1]) throw new Error('Usage: node install.mjs --install /absolute/path/to/node')
const node = resolve(args[1])
const source = dirname(fileURLToPath(import.meta.url))
const target = join(homedir(), 'Library/Application Support/Atomic Chat Personal Tools')
await mkdir(join(target, 'node_modules'), { recursive: true, mode: 0o700 })
await cp(node, join(target, 'node'))
for (const name of ['server.mjs','store.mjs','browser.mjs','windows.mjs','watch.mjs']) await cp(join(source, name), join(target, name))
await cp(join(source, '../../node_modules/playwright-core'), join(target, 'node_modules/playwright-core'), { recursive: true })
const configPath = join(homedir(), 'Library/Application Support/Atomic Chat/data/mcp_config.json')
const original = await readFile(configPath, 'utf8')
const config = JSON.parse(original)
const key = 'atomic-personal-tools'
config.mcpServers ??= {}
if (config.mcpServers[key] && config.mcpServers[key].command !== join(target, 'node')) throw new Error('A different connector already uses atomic-personal-tools; refusing to replace it')
config.mcpServers[key] = {
  command: join(target, 'node'), args: [join(target, 'server.mjs')],
  env: { ATOMIC_PERSONAL_TOOLS_DIR: join(target, 'data'), ATOMIC_PERSONAL_ENDPOINT: 'http://127.0.0.1:8010/v1', ATOMIC_PERSONAL_MODEL: 'qwen3.8-flash-next-chat', ATOMIC_PERSONAL_WORKSPACE: join(homedir(), 'Library/Application Support/Atomic Chat/data/agent-workspace') },
  type: 'stdio', active: false, timeout: 30,
}
await writeFile(join(target, `mcp-config-before-${Date.now()}.json`), original, { mode: 0o600, flag: 'wx' })
await writeFile(`${configPath}.personal.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 })
await rename(`${configPath}.personal.tmp`, configPath)
process.stdout.write('Personal tools installed, connector disabled until enabled in Personal Chat. Other connectors preserved.\n')
