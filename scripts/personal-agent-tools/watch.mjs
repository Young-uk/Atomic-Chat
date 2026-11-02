import { watch } from 'chokidar'
import { realpath, stat } from 'node:fs/promises'
import { relative, resolve, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Watches report bounded change events, never execute code or ingest contents. */
export class PersonalWatch {
  constructor(root, store) { this.root = root; this.store = store; this.watches = new Map(); this.restoreErrors = [] }
  async call(args) {
    if (args.action === 'start') {
      return this.start(args)
    }
    if (args.action === 'stop') {
      const entry = this.watches.get(args.id)
      if (!entry && !this.restoreErrors.some(row => row.id === args.id)) throw new Error('Watch not found')
      await this.store?.watchDefinition('forget', { id: args.id })
      entry?.watcher.close()
      this.watches.delete(args.id)
      this.restoreErrors = this.restoreErrors.filter(row => row.id !== args.id)
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
    return [...[...this.watches.values()].map(({ id, path, events, dropped, error, persistent }) => ({ id, path, persistent, pendingEvents: events.length, dropped, error })), ...this.restoreErrors]
  }
  async start(args, id = randomUUID()) {
      if (this.watches.size >= 8) throw new Error('At most eight active watches are supported')
      if (typeof args.path !== 'string' || !args.path) throw new Error('A path relative to the configured workspace is required')
      const root = await realpath(this.root)
      const target = await realpath(resolve(root, args.path))
      const rel = relative(root, target)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('Watch target is outside the configured workspace')
      if (!(await stat(target)).isDirectory()) throw new Error('Watch a directory, not an individual file')
      if (args.persistent && !this.store) throw new Error('Persistent watch storage is unavailable')
      const entry = { id, path: target, persistent: Boolean(args.persistent), events: [], dropped: 0, error: null }
      // Polling avoids exhausting the shared macOS native watch queue. The
      // explicit workspace and eight-watch cap keep the scope bounded.
      entry.watcher = watch(target, { ignoreInitial: true, followSymlinks: false, usePolling: true, interval: 500 })
      entry.watcher.on('all', (event, filename) => {
        // File names are evidence only: neither path strings nor events run.
        entry.events.push({ event, name: relative(target, filename).slice(0, 1000), at: new Date().toISOString() })
        if (entry.events.length > 100) { entry.events.shift(); entry.dropped++ }
      })
      entry.watcher.on('error', error => { entry.error = error.message })
      try {
        // A successful start is a readiness boundary: callers may write
        // immediately after it without losing the first change to scanning.
        await new Promise((resolve, reject) => {
          entry.watcher.once('ready', resolve)
          entry.watcher.once('error', reject)
        })
        if (entry.persistent) await this.store.watchDefinition('save', { id: entry.id, path: target })
      } catch (error) { entry.watcher.close(); throw error }
      this.watches.set(entry.id, entry)
      return { id: entry.id, path: target, persistent: entry.persistent }
  }
  async restore() {
    for (const row of await this.store?.watchDefinition('list') ?? []) {
      try { await this.start({ path: row.path, persistent: true }, row.id) }
      catch (error) { this.restoreErrors.push({ ...row, persistent: true, error: error.message, restored: false }) }
    }
  }
  shutdown() { for (const entry of this.watches.values()) entry.watcher.close(); this.watches.clear() }
}
