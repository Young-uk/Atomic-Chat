import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { build } from 'esbuild'

const directory = fileURLToPath(new URL('./agent-source/', import.meta.url))
const sources = (await readdir(directory, { recursive: true })).filter(name => name.endsWith('.ts'))
await build({ entryPoints: sources.map(name => join(directory, name)), outbase: directory, outdir: directory, outExtension: { '.js': '.mjs' }, platform: 'node', format: 'esm', target: 'node25', legalComments: 'inline', minify: false })
