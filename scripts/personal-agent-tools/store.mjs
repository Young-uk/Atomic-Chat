import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveScheduledFor, peekNextFirings } from './agent-source/task-schedule.mjs'

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
      if (action === 'preview') {
        if (!args.cron) throw new Error('cron expression is required')
        const schedule = { kind: 'cron', expression: args.cron, ...(args.timezone ? { tz: args.timezone } : {}) }
        resolveScheduledFor(schedule, this.now())
        return { times: peekNextFirings(schedule, this.now()).map(time => new Date(time).toISOString()) }
      }
      if (action === 'create') {
        if (args.cron && (args.at || args.intervalSeconds)) throw new Error('Choose either cron or at/interval, not both')
        if (args.timezone && !args.cron) throw new Error('timezone is only used with cron')
        const schedule = args.cron ? { kind: 'cron', expression: args.cron, ...(args.timezone ? { tz: args.timezone } : {}) } : null
        const intervalSeconds = args.intervalSeconds ?? null
        if (intervalSeconds !== null && (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60)) throw new Error('Repeat interval must be at least 60 seconds')
        // Capture receipt time once: inference and approval can outlive an
        // absolute deadline. Relative repeats start from receipt, never from
        // a stale model-generated timestamp. Explicit deadlines stay explicit.
        const now = this.now()
        const hasAt = args.at !== undefined
        const invalid = (code, message, extra = {}) => Object.assign(new Error(message), {
          scheduleValidation: { code, retryable: false, taskCreated: false, currentTime: new Date(now).toISOString(), ...extra }
        })
        if (!schedule && !hasAt && intervalSeconds === null) throw invalid('missing_start_time', 'Provide at with an explicit timezone, or intervalSeconds for a relative repeat.')
        if (!schedule && hasAt && (typeof args.at !== 'string' || !/([zZ]|[+-]\d\d:\d\d)$/.test(args.at) || !Number.isFinite(Date.parse(args.at)))) throw invalid('invalid_start_time', 'at must be a valid ISO timestamp including timezone. Do not retry unchanged arguments.')
        const dueAt = schedule ? resolveScheduledFor(schedule, now) : hasAt ? Date.parse(args.at) : now + intervalSeconds * 1000
        if (!Number.isFinite(dueAt)) throw invalid('invalid_start_time', 'The schedule does not resolve to a valid timestamp.')
        if (dueAt <= now) throw invalid('start_time_passed', 'The requested start time has passed. No task was created. Do not retry this timestamp or invent a replacement; ask for a new start time. For an authorized relative repeat, omit at and use intervalSeconds.', { requestedTime: new Date(dueAt).toISOString(), overdueSeconds: Math.ceil((now - dueAt) / 1000) })
        const task = { id: randomUUID(), prompt: bounded(args.prompt, 12000, 'prompt'), dueAt, intervalSeconds, ...(schedule ? { schedule } : {}), status: 'scheduled', createdAt: this.now(), runs: [] }
        if (args.originThreadId) task.originThreadId = bounded(args.originThreadId, 200, 'originThreadId')
        if (args.assistantInstructions) task.assistantInstructions = bounded(args.assistantInstructions, 100000, 'assistantInstructions')
        if (state.tasks.length >= 1000) throw new Error('Scheduled-task capacity reached')
        state.tasks.push(task)
        return publicTask(task)
      }
      const task = state.tasks.find(item => item.id === args.id)
      if (action === 'cancel') {
        if (!task) throw new Error('Task not found')
        task.status = 'cancelled'
        return publicTask(task)
      }
      if (action === 'acknowledge') {
        if (!task) throw new Error('Task not found')
        task.acknowledgedAt = this.now()
        return publicTask(task)
      }
      if (action === 'get') {
        if (!task) throw new Error('Task not found')
        return { ...publicTask(task), runs: task.runs.slice(-1) }
      }
      return state.tasks.slice(-20).map(item => ({ ...publicTask(item), runs: item.runs.slice(-1).map(run => ({ ...run, result: run.result?.slice(0, 500), preview: Boolean(run.result?.length > 500) })) }))
    })
  }

  watchDefinition(action, entry = {}) {
    return this.transact(state => {
      if (action === 'list') return structuredClone(state.watches ?? [])
      state.watches ??= []
      if (action === 'forget') {
        state.watches = state.watches.filter(row => row.id !== entry.id)
        return
      }
      if (action !== 'save') throw new Error('Unknown watch-definition action')
      if (state.watches.length >= 8 && !state.watches.some(row => row.id === entry.id)) throw new Error('At most eight persistent watches are supported')
      const row = { id: bounded(entry.id, 100, 'watch id'), path: bounded(entry.path, 4000, 'watch path') }
      state.watches = [...state.watches.filter(item => item.id !== row.id), row]
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
      const run = { id: randomUUID(), finishedAt: this.now(), result, error,
        delivery: error ? { status: 'skipped', attempts: 0, reason: 'generation_failed' } : { status: 'pending', attempts: 0 } }
      task.runs.push(run)
      task.runs = task.runs.slice(-20)
      // A cancellation that races inference must remain cancelled.
      if (task.status === 'cancelled') { run.delivery.status = 'cancelled'; return }
      // A failed occurrence is history, not cancellation of the recurrence.
      // Skip missed intervals rather than flooding the model with catch-up work.
      if (task.schedule || task.intervalSeconds) {
        const now = this.now()
        task.dueAt = task.schedule ? resolveScheduledFor(task.schedule, now) :
          task.dueAt + Math.max(1, Math.floor((now - task.dueAt) / (task.intervalSeconds * 1000)) + 1) * task.intervalSeconds * 1000
        task.status = 'scheduled'
      } else task.status = error ? 'failed' : 'completed'
    })
  }

  // Delivery is a durable outbox, independent of inference. A failed desktop
  // notification must neither rerun the model nor erase a generated result.
  delivery(action, args = {}) {
    return this.transact(state => {
      if (action === 'pending') return state.tasks.flatMap(task => task.runs
        .filter(run => run.delivery && ['pending', 'failed'].includes(run.delivery.status))
        .map(run => ({ taskId: task.id, threadId: task.originThreadId, ...run }))).slice(0, 50)
      const task = state.tasks.find(task => task.id === args.taskId)
      const run = task?.runs.find(run => run.id === args.runId)
      if (!run?.delivery) throw new Error('Scheduled result not found')
      if (['cancelled', 'delivered', 'skipped'].includes(run.delivery.status)) return run.delivery
      run.delivery = { ...run.delivery, status: args.error ? 'failed' : 'delivered',
        attempts: run.delivery.attempts + 1, attemptedAt: this.now(),
        ...(args.error ? { error: bounded(args.error, 2000, 'delivery error') } : { error: null }),
        ...(args.messageId ? { messageId: bounded(args.messageId, 200, 'messageId') } : {}) }
      return run.delivery
    })
  }
}

export function bounded(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must contain 1-${max} characters`)
  return value
}

function publicTask(task) {
  // Voice instructions belong to the execution context, not tool output that
  // would repeatedly inject a large instruction snapshot into chat history.
  const { assistantInstructions: _instructions, ...visible } = task
  return visible
}
