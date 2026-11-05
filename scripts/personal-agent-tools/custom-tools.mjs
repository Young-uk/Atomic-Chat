import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import { mkdir } from 'node:fs/promises'
const execute = promisify(execFile)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Deliberately small schema dialect. Reject unsupported constraints instead of
// claiming that arbitrary model-authored JSON Schema was validated.
export function validateCustomSchema(schema, value, path = 'input', checkValue = true) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid custom input schema')
  const allowed = ['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum']
  for (const key of Object.keys(schema)) if (!allowed.includes(key)) throw new Error(`Unsupported schema keyword: ${key}`)
  if (!['object','array','string','number','integer','boolean','null'].includes(schema.type)) throw new Error('Explicit schema type is required')
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length)) throw new Error('Invalid schema enum')
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) throw new Error('Object schemas require additionalProperties=false')
    const properties = schema.properties ?? {}
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Invalid schema properties')
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key)))) throw new Error('Invalid required properties')
    for (const child of Object.values(properties)) validateCustomSchema(child, undefined, path, false)
  }
  if (schema.type === 'array') validateCustomSchema(schema.items, undefined, path, false)
  if (!checkValue) return
  const valid = schema.type === 'null' ? value === null : schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : schema.type === 'integer' ? Number.isInteger(value) : typeof value === schema.type
  if (!valid || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Invalid ${path}: expected ${schema.type}`)
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`Invalid ${path}: not in enum`)
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`Missing ${path}.${key}`)
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`Unexpected ${path}.${key}`)
      validateCustomSchema(schema.properties[key], item, `${path}.${key}`)
    }
  }
  if (schema.type === 'array') for (const item of value) validateCustomSchema(schema.items, item, `${path}[]`)
}

export class CustomTools {
  constructor(store, workspace, runner = execute) { this.store = store; this.workspace = workspace; this.runner = runner }
  async list() { return this.store.transact(state => structuredClone(state.customTools ?? [])) }
  async save(args) {
    if (!/^custom\.[a-z][a-z0-9_]{0,47}$/.test(args.name ?? '')) throw new Error('Custom names must be custom.lowercase_name')
    for (const [key, max] of [['description',2000],['code',32000],['source',2000],['inputSchema',16000]]) if (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > max) throw new Error(`Invalid custom ${key}`)
    const inputSchema = JSON.parse(args.inputSchema)
    if (inputSchema.type !== 'object') throw new Error('Top-level schema must be an object')
    validateCustomSchema(inputSchema, undefined, 'input', false)
    new Script(`(async function(input) {\n${args.code}\n})`)
    const definition = { name: args.name, description: args.description, inputSchema, code: args.code, source: args.source }
    definition.revision = hash(definition)
    return this.store.transact(state => {
      const rows = state.customTools ??= []
      const index = rows.findIndex(row => row.name === args.name)
      if (index < 0 && rows.length >= 50) throw new Error('Custom tool capacity reached')
      if (index < 0) rows.push(definition); else rows[index] = definition
      return { name: definition.name, revision: definition.revision, status: 'saved', execution: 'requires_inspected_approval' }
    })
  }
  async remove(name) { return this.store.transact(state => { const before = state.customTools ?? []; state.customTools = before.filter(row => row.name !== name); return { removed: state.customTools.length !== before.length } }) }
  async get(name) { const row = (await this.list()).find(row => row.name === name); if (!row) throw new Error('Custom tool not found'); return row }
  async run(name, input, approvals, pendingId) {
    const definition = await this.get(name)
    validateCustomSchema(definition.inputSchema, input)
    // The immutable definition is part of the approval args and plan. Editing a
    // tool between inspection and confirmation invalidates the confirmation.
    const args = { input, definition }
    return approvals.run(name, args, async () => {
      await approvals.request({ tool: name, category: 'custom_code', reason: 'Execute user-authored JavaScript with this host user permissions; this is not a sandbox.', code: definition.code, source: definition.source, input, revision: definition.revision })
      await mkdir(this.workspace, { recursive: true, mode: 0o700 })
      const payload = Buffer.from(JSON.stringify(args)).toString('base64')
      const script = `const a=JSON.parse(Buffer.from(process.argv[1],'base64').toString()); const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor; Promise.resolve(new AsyncFunction('input',a.definition.code)(a.input)).then(value=>process.stdout.write(JSON.stringify(value??null))).catch(error=>{process.stderr.write(error.message);process.exitCode=1})`
      const result = await this.runner(process.execPath, ['-e', script, payload], { cwd: this.workspace, timeout: 30000, maxBuffer: 256 * 1024,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } })
      return JSON.parse(result.stdout)
    }, pendingId)
  }
}
