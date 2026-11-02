import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const DEFAULT_FEATURE_SETTINGS = { version: 1, memoryMaintenance: { enabled: false, queryRewrite: false }, semanticMemory: { enabled: false, url: 'http://127.0.0.1:19092/v1', model: '', dimensions: 768 } }
export function validateFeatureSettings(input) {
  if (!input || input.version !== 1 || Object.keys(input).some(k => !['version', 'semanticMemory', 'memoryMaintenance'].includes(k))) throw new Error('Invalid Personal feature settings')
  if (input.memoryMaintenance !== undefined && (!input.memoryMaintenance || typeof input.memoryMaintenance.enabled !== 'boolean' || Object.keys(input.memoryMaintenance).some(k => !['enabled','queryRewrite'].includes(k)))) throw new Error('Invalid memory maintenance settings')
  if (input.memoryMaintenance?.queryRewrite !== undefined && typeof input.memoryMaintenance.queryRewrite !== 'boolean') throw new Error('Invalid query rewriting setting')
  const m = input.semanticMemory
  if (!m || Object.keys(m).some(k => !['enabled','url','model','dimensions'].includes(k)) || typeof m.enabled !== 'boolean' || typeof m.url !== 'string' || typeof m.model !== 'string' || m.model.length > 200 || !Number.isSafeInteger(m.dimensions) || m.dimensions < 1 || m.dimensions > 8192) throw new Error('Invalid embedding settings')
  const url = new URL(m.url)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Embedding settings require a loopback endpoint')
  if (m.enabled && !m.model.trim()) throw new Error('Choose an embedding model before enabling semantic memory')
  return { ...structuredClone(input), memoryMaintenance: { enabled: input.memoryMaintenance?.enabled ?? false, queryRewrite: input.memoryMaintenance?.queryRewrite ?? false } }
}
export class PersonalFeatureSettings {
  constructor(directory) { this.path = join(directory, 'feature-settings.json'); this.queue = Promise.resolve() }
  async get() {
    try { return validateFeatureSettings(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(DEFAULT_FEATURE_SETTINGS); throw error }
  }
  set(value) {
    const validated = validateFeatureSettings(value)
    const save = this.queue.then(async () => {
      const temp = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(validated, null, 2)+'\n', { mode: 0o600 })
      await rename(temp, this.path)
      return validated
    }); this.queue = save.catch(() => {}); return save
  }
}
