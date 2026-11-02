import { createHash } from 'node:crypto'

// Compare the live registry with the original ordered descriptors. A descriptor
// alone does not mean its gated tool is connected or has usable configuration.
export const AGENT_FAMILIES = [
  ['browser', ['browser.']],
  ['files', ['os.fs.']],
  ['git', ['os.git.', 'github.']],
  ['desktop', ['os.clipboard.', 'os.window.', 'os.notify', 'os.screen.']],
  ['processes', ['os.shell.', 'os.proc.']],
  ['web', ['os.http.', 'os.web.']],
  ['mail', ['os.email.']],
  ['memory', ['memory.']],
  ['tasks', ['tasks.']],
  ['skills', ['skill.', 'tool.']],
  ['verification', ['verify.']],
  ['collaboration', ['fusion.']],
  ['media', ['vision.', 'image.', 'video.']],
  ['connectors', ['mcp.', 'mcp__']],
  ['conversation', ['reply', 'finish']],
]

export function agentFamily(name) {
  return AGENT_FAMILIES.find(([, prefixes]) => prefixes.some(prefix =>
    prefix.endsWith('.') || prefix.endsWith('__') ? name.startsWith(prefix) : name === prefix,
  ))?.[0] ?? 'unclassified'
}

export function auditAgentCatalog(descriptors, registeredNames) {
  if (!Array.isArray(descriptors) || !Array.isArray(registeredNames)) throw new Error('Agent catalog and registry are required')
  const registered = new Set(registeredNames)
  const entries = new Map()
  const duplicateNames = []
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) throw new Error('Agent descriptor has no name')
    if (entries.has(descriptor.name)) {
      // Upstream has three historical duplicate Git descriptors. Preserve the
      // first projection and report every duplicate instead of hiding drift.
      duplicateNames.push(descriptor.name)
      continue
    }
    const schema = descriptor.argsJsonSchema
    const hasSchema = schema !== null && typeof schema === 'object' && !Array.isArray(schema)
    entries.set(descriptor.name, {
      name: descriptor.name,
      family: agentFamily(descriptor.name),
      registered: registered.has(descriptor.name),
      hasSchema,
      status: !registered.has(descriptor.name) ? 'unavailable' : !hasSchema ? 'missing-schema' : 'available',
    })
  }
  // A dynamically registered connector without a descriptor must be visible in
  // the audit too. Never silently advertise a guessed permissive JSON schema.
  for (const name of registered) {
    if (typeof name !== 'string' || !name) throw new Error('Agent registry has an invalid name')
    if (!entries.has(name)) entries.set(name, {
      name, family: agentFamily(name), registered: true, hasSchema: false, status: 'missing-descriptor',
    })
  }
  const tools = [...entries.values()]
  return {
    tools,
    duplicateNames,
    descriptorCount: descriptors.length,
    registeredCount: registered.size,
    fingerprint: createHash('sha256').update(JSON.stringify(descriptors)).digest('hex'),
    complete: tools.every(tool => tool.family !== 'unclassified' && tool.status === 'available'),
  }
}
