import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export class PersonalStore {
  constructor(directory, now = () => Date.now()) {
    this.directory = directory
    this.now = now
    this.queue = Promise.resolve()
  }

  // Every read-modify-write shares this queue. A rejected transaction must not
  // poison later requests, and replacement is atomic across process crashes.
  transact(update) {
    const result = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const path = join(this.directory, 'state.json')
      let state
      try { state = JSON.parse(await readFile(path, 'utf8')) }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        state = { version: 1, memories: [], tasks: [] }
      }
      if (state.version !== 1) throw new Error('Unsupported personal state version')
      const before = JSON.stringify(state)
      const value = await update(state)
      const serialized = JSON.stringify(state)
      // Polling and unsuccessful claims are reads, not periodic disk writes.
      if (serialized === before) return value
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, serialized, { mode: 0o600, flag: 'wx', flush: true })
      await rename(temporary, path)
      return value
    })
    this.queue = result.catch(() => {})
    return result
  }

  memory(action, args = {}) {
    return this.transact(state => {
      if (action === 'save') {
        const text = bounded(args.text, 12000, 'text')
        const source = bounded(args.source, 2000, 'source')
        const entry = { id: randomUUID(), text, source, kind: args.kind ?? 'note', createdAt: this.now(), updatedAt: this.now() }
        if (state.memories.length >= 2000) throw new Error('Memory capacity reached; forget unused entries first')
        state.memories.push(entry)
        return entry
      }
      if (action === 'update' || action === 'forget') {
        const entry = state.memories.find(item => item.id === args.id)
        if (!entry) throw new Error('Memory not found')
        if (action === 'forget') state.memories = state.memories.filter(item => item.id !== args.id)
        else {
          entry.text = bounded(args.text, 12000, 'text')
          entry.source = bounded(args.source, 2000, 'source')
          entry.updatedAt = this.now()
        }
        return { id: entry.id, action }
      }
      const words = String(args.query ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean)
      return state.memories.map(entry => ({ ...entry, score: words.reduce((score, word) => score + Number(`${entry.text} ${entry.source}`.toLocaleLowerCase().includes(word)), 0) }))
        .filter(entry => !words.length || entry.score > 0)
        .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, 20)
    })
  }

  task(action, args = {}) {
    return this.transact(state => {
      if (action === 'create') {
        const dueAt = Date.parse(args.at)
        if (!Number.isFinite(dueAt) || dueAt <= this.now()) throw new Error('at must be a future ISO timestamp including timezone')
        if (!/([zZ]|[+-]\d\d:\d\d)$/.test(args.at)) throw new Error('at requires an explicit timezone')
        const intervalSeconds = args.intervalSeconds ?? null
        if (intervalSeconds !== null && (!Number.isInteger(intervalSeconds) || intervalSeconds < 60)) throw new Error('Repeat interval must be at least 60 seconds')
        const task = { id: randomUUID(), prompt: bounded(args.prompt, 12000, 'prompt'), dueAt, intervalSeconds, status: 'scheduled', createdAt: this.now(), runs: [] }
        if (state.tasks.length >= 1000) throw new Error('Scheduled-task capacity reached')
        state.tasks.push(task)
        return task
      }
      const task = state.tasks.find(item => item.id === args.id)
      if (action === 'cancel') {
        if (!task) throw new Error('Task not found')
        task.status = 'cancelled'
        return task
      }
      if (action === 'acknowledge') {
        if (!task) throw new Error('Task not found')
        task.acknowledgedAt = this.now()
        return task
      }
      if (action === 'get') {
        if (!task) throw new Error('Task not found')
        return { ...task, runs: task.runs.slice(-1) }
      }
      return state.tasks.slice(-20).map(item => ({ ...item, runs: item.runs.slice(-1).map(run => ({ ...run, result: run.result?.slice(0, 500), preview: Boolean(run.result?.length > 500) })) }))
    })
  }

  // Startup never silently replays work missed while the application was shut.
  reconcileStartup() {
    return this.transact(state => {
      for (const task of state.tasks) {
        if (task.status === 'running' || (task.status === 'scheduled' && task.dueAt < this.now())) task.status = 'missed'
      }
    })
  }

  claimDue() {
    return this.transact(state => {
      const task = state.tasks.find(item => item.status === 'scheduled' && item.dueAt <= this.now())
      if (!task) return null
      task.status = 'running'
      return structuredClone(task)
    })
  }

  finish(id, result, error = null) {
    return this.transact(state => {
      const task = state.tasks.find(item => item.id === id)
      if (!task) return
      task.runs.push({ finishedAt: this.now(), result, error })
      task.runs = task.runs.slice(-20)
      // A cancellation that races inference must remain cancelled.
      if (task.status === 'cancelled') return
      if (error) task.status = 'failed'
      else if (task.intervalSeconds) {
        task.dueAt = this.now() + task.intervalSeconds * 1000
        task.status = 'scheduled'
      } else task.status = 'completed'
    })
  }
}

export function bounded(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must contain 1-${max} characters`)
  return value
}
