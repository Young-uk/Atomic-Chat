import { watch } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { relative, resolve, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Watches report bounded change events, never execute code or ingest contents. */
export class PersonalWatch {
  constructor(root) { this.root = root; this.watches = new Map() }
  async call(args) {
    if (args.action === 'start') {
      if (this.watches.size >= 8) throw new Error('At most eight active watches are supported')
      if (typeof args.path !== 'string' || !args.path) throw new Error('A path relative to the configured workspace is required')
      const root = await realpath(this.root)
      const target = await realpath(resolve(root, args.path))
      const rel = relative(root, target)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('Watch target is outside the configured workspace')
      if (!(await stat(target)).isDirectory()) throw new Error('Watch a directory, not an individual file')
      const entry = { id: randomUUID(), path: target, events: [], dropped: 0, error: null }
      entry.watcher = watch(target, { recursive: true }, (event, filename) => {
        // File names are evidence only: neither path strings nor events run.
        entry.events.push({ event, name: String(filename ?? '').slice(0, 1000), at: new Date().toISOString() })
        if (entry.events.length > 100) { entry.events.shift(); entry.dropped++ }
      })
      entry.watcher.on('error', error => { entry.error = error.message })
      this.watches.set(entry.id, entry)
      return { id: entry.id, path: target }
    }
    if (args.action === 'stop') {
      const entry = this.watches.get(args.id)
      if (!entry) throw new Error('Watch not found')
      entry.watcher.close()
      this.watches.delete(args.id)
      return { stopped: args.id }
    }
    if (args.action === 'events') {
      const entry = this.watches.get(args.id)
      if (!entry) throw new Error('Watch not found')
      const result = { id: entry.id, events: entry.events, dropped: entry.dropped, error: entry.error }
      entry.events = []
      entry.dropped = 0
      return result
    }
    return [...this.watches.values()].map(({ id, path, events, dropped, error }) => ({ id, path, pendingEvents: events.length, dropped, error }))
  }
  shutdown() { for (const entry of this.watches.values()) entry.watcher.close(); this.watches.clear() }
}
