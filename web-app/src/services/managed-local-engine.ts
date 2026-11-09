import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'

export type LocalEngine = 'dstar' | 'strata'
export type LocalEngineTarget = { engine: LocalEngine; provider: string; model: string }
export type LocalEngineSnapshot = {
  maxContext?: number | null
  engine: LocalEngine | null
  desiredEngine?: LocalEngine | null
  status: 'stopped' | 'loading' | 'ready' | 'stopping' | 'error' | 'external'
  owned: boolean
  servedModels: string[]
  strataContext?: number
  activeContext?: number | null
  elapsedSeconds?: number
  error?: string | null
}
export type LocalEngineState = {
  target: LocalEngineTarget | null
  phase: 'idle' | 'waiting' | 'loading' | 'stopping' | 'ready' | 'error'
  snapshot?: LocalEngineSnapshot
  error?: string
}
export const STRATA_PROVIDER = 'Strata · ISTA IQ3_XXS'
export const STRATA_MODEL = 'ista-iq3-xxs'

/** Lifecycle privileges belong only to the two registered loopback services. */
export function localEngineTarget(
  provider?: Pick<ModelProvider, 'provider' | 'base_url' | 'active' | 'models'>,
  model?: Pick<Model, 'id'> | null
): LocalEngineTarget | null {
  if (!provider || provider.active === false || !model ||
      !provider.models.some(entry => entry.id === model.id)) return null
  try {
    const url = new URL(provider.base_url ?? '')
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash ||
        !['/v1', '/v1/'].includes(url.pathname)) return null
    const engine = url.port === '8010' ? 'dstar' :
      url.port === '18080' && provider.provider === STRATA_PROVIDER && model.id === STRATA_MODEL
        ? 'strata' : null
    return engine ? { engine, provider: provider.provider, model: model.id } : null
  } catch { return null }
}

export const controlLocalEngine = (action: 'ensure' | 'status' | 'stop' | 'quiesce' | 'resume', engine: LocalEngine | null, strataContext?: number) =>
  invoke<LocalEngineSnapshot>('managed_engine_control', { action, engine, ...(strataContext === undefined ? {} : { strataContext }) })

const key = (target: LocalEngineTarget | null) => target
  ? `${target.engine}:${target.provider}:${target.model}` : ''
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 500))
const initialState: LocalEngineState = { target: null, phase: 'idle' }
export const useLocalEngine = create<LocalEngineState>(() => initialState)

/** One queue, latest selection wins; stale IPC completions never paint the UI. */
export class LocalEngineCoordinator {
  private target: LocalEngineTarget | null = null
  private revision = 0
  private pending = false
  private running: Promise<void> | null = null
  private refreshing: Promise<void> | null = null
  private leases = 0
  private requestEngine: LocalEngine | null = null
  private state: LocalEngineState = initialState
  private prepare?: () => Promise<void>
  private transition?: { quiesce: (engine: LocalEngine | null) => Promise<unknown>; resume: () => Promise<unknown> }
  private quiescing = false
  private preparingTransition = false
  private busy: (exceptChatId?: string) => boolean = () => false

  constructor(
    private control = controlLocalEngine,
    private publish: (state: LocalEngineState) => void = state => useLocalEngine.setState(state, true),
    private pause = delay,
    private timeoutMs = 10 * 60_000
  ) {}

  async prepareStart(): Promise<void> {
    if (this.leases || this.busy()) throw new Error('engineBusy')
    await this.prepare?.()
  }

  configurePrepare(prepare: () => Promise<void>) { this.prepare = prepare }
  configureTransition(transition: LocalEngineCoordinator['transition']) { this.transition = transition }

  private async beforeTransition(engine: LocalEngine | null, current: () => boolean): Promise<boolean> {
    if (!this.transition) return current()
    this.quiescing = true
    try {
      await this.transition.quiesce(engine)
      if (!current()) { await this.transition.resume(); return false }
      return true
    } catch (error) {
      await this.transition.resume().catch(() => undefined)
      throw error
    } finally { this.quiescing = false }
  }
  async settled(): Promise<void> { if (this.running) await this.running }

  configureBusy(busy: (exceptChatId?: string) => boolean) { this.busy = busy }
  private update(state: LocalEngineState) { this.state = state; this.publish(state) }

  selectEngineTarget(target: LocalEngineTarget | null, start = true): void {
    if (key(this.target) === key(target)) return
    this.target = target
    this.revision++
    this.pending = Boolean(target && start)
    this.update({ target, phase: this.pending ? 'loading' : 'idle' })
    this.resume()
  }

  /** Adopt an explicit panel start's verified result without starting again or
   * replacing the native model/context configuration. Never revive stale work. */
  reconcileReady(target: LocalEngineTarget, snapshot: LocalEngineSnapshot): boolean {
    if (key(target) !== key(this.target) || this.running || this.pending ||
        this.leases || this.busy() || this.state.phase === 'stopping' ||
        snapshot.engine !== target.engine || snapshot.status !== 'ready' ||
        !snapshot.owned || snapshot.error || !snapshot.servedModels.includes(target.model)) return false
    this.revision++
    this.update({ target: this.target, phase: 'ready', snapshot })
    return true
  }

  startSelected(target: LocalEngineTarget): void {
    this.selectEngineTarget(target)
    if (this.state.phase === 'idle' || this.state.phase === 'error') this.retry()
  }

  retry(): void {
    if (!this.target) return
    this.revision++
    this.pending = true
    this.update({ target: this.target, phase: 'loading' })
    this.resume()
  }

  resume(): void {
    if (!this.pending || this.running || !this.target) return
    if (this.leases || this.busy()) {
      this.update({ target: this.target, phase: 'waiting' })
      return
    }
    void this.run()
  }

  private run(forRequest = false): Promise<void> {
    if (this.running) return this.running
    if (!this.pending || !this.target) return Promise.resolve()
    if (!forRequest && (this.leases || this.busy())) {
      this.update({ target: this.target, phase: 'waiting' })
      return Promise.resolve()
    }
    const target = this.target
    const revision = this.revision
    const current = () => revision === this.revision
    this.pending = false
    const work = async () => {
      this.preparingTransition = Boolean(this.transition)
      const deadline = Date.now() + this.timeoutMs
      let prepared = false
      try {
        if (this.prepare) await this.prepare()
        if (!current()) return
        if (this.transition && !await this.beforeTransition(target.engine, current)) return
        if (!current()) { await this.transition?.resume(); return }
        prepared = true
        this.preparingTransition = false
        let snapshot = await this.control('ensure', target.engine)
        let inspectionRetries = 0
        while (current()) {
          // A failed inspection is not a foreign listener. Retry only read-only
          // status, and require fresh native ownership before granting a lease.
          if (snapshot.error === 'processInspectionFailed' && snapshot.owned &&
              snapshot.engine === target.engine && inspectionRetries++ < 2 && Date.now() < deadline) {
            this.update({ target, phase: 'loading', snapshot })
            await this.pause()
            if (!current()) return
            snapshot = await this.control('status', target.engine)
            continue
          }
          if (snapshot.error || snapshot.status === 'error' || snapshot.status === 'external') {
            throw new Error(snapshot.error || (snapshot.status === 'external' ? 'foreignEngine' : 'engineFailed'))
          }
          if (snapshot.engine === target.engine && snapshot.status === 'ready') {
            if (!snapshot.owned) throw new Error('foreignEngine')
            if (!snapshot.servedModels.includes(target.model)) throw new Error('modelNotServed')
            this.update({ target, phase: 'ready', snapshot })
            return
          }
          this.update({ target, phase: 'loading', snapshot })
          if (Date.now() >= deadline) throw new Error('engineTimeout')
          await this.pause()
          if (!current()) return
          snapshot = await this.control('status', target.engine)
        }
      } catch (error) {
        if (prepared) await this.transition?.resume().catch(() => undefined)
        if (current()) this.update({ target, phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
    const operation = work().finally(() => {
      this.preparingTransition = false
      if (this.running === operation) {
        this.running = null
        this.resume()
      }
    })
    this.running = operation
    return operation
  }

  async refresh(exceptChatId?: string): Promise<void> {
    if (this.refreshing) return this.refreshing
    if ((this.state.phase === 'error' && this.state.error !== 'processInspectionFailed') || this.running || this.pending || !this.target || this.leases || this.busy(exceptChatId)) return
    const target = this.target
    const revision = this.revision
    const work = async () => {
      try {
        const snapshot = await this.control('status', target.engine)
        if (revision !== this.revision || this.running || this.pending) return
        if (snapshot.error || snapshot.status === 'error' || snapshot.status === 'external') {
          this.update({ target, phase: 'error', snapshot, error: snapshot.error || 'foreignEngine' })
        } else if (snapshot.engine === target.engine && snapshot.status === 'ready' && !snapshot.owned) {
          this.update({ target, phase: 'error', snapshot, error: 'foreignEngine' })
        } else if (snapshot.engine === target.engine && snapshot.status === 'ready') {
          this.update({ target, phase: snapshot.servedModels.includes(target.model) ? 'ready' : 'error', snapshot,
            error: snapshot.servedModels.includes(target.model) ? undefined : 'modelNotServed' })
        } else if (snapshot.engine === target.engine && (snapshot.status === 'loading' || snapshot.status === 'stopping')) {
          this.update({ target, phase: snapshot.status, snapshot })
        } else if (snapshot.status === 'stopped' || snapshot.engine !== target.engine) {
          this.update({ target, phase: 'idle', snapshot })
        }
      } catch (error) {
        if (revision === this.revision && !this.running && !this.pending) this.update({ target, phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
    const operation = work().finally(() => {
      if (this.refreshing === operation) this.refreshing = null
    })
    this.refreshing = operation
    return operation
  }

  cancel(): void {
    if (!this.target || this.leases || this.busy()) return
    const target = this.target
    const abandonTransition = this.quiescing || this.preparingTransition
    const revision = ++this.revision
    this.pending = false
    this.update({ target, phase: 'stopping' })
    const operation = (this.running ?? Promise.resolve()).then(async () => {
      if (revision !== this.revision) return
      let prepared = false
      try {
        if (abandonTransition) {
          this.update({ target, phase: 'idle' })
          return
        }
        if (this.transition && !await this.beforeTransition(null, () => revision === this.revision)) return
        if (revision !== this.revision) { await this.transition?.resume(); return }
        prepared = true
        let snapshot = await this.control('stop', target.engine)
        const deadline = Date.now() + 190_000
        while (revision === this.revision && snapshot.status !== 'stopped') {
          if (snapshot.error || snapshot.status === 'error' || snapshot.status === 'external') throw new Error(snapshot.error || 'stopFailed')
          if (Date.now() >= deadline) throw new Error('stopFailed')
          this.update({ target, phase: 'stopping', snapshot })
          await this.pause()
          if (revision !== this.revision) return
          snapshot = await this.control('status', target.engine)
        }
        if (revision === this.revision) this.update({ target, phase: 'idle', snapshot })
      } catch (error) {
        if (prepared) await this.transition?.resume().catch(() => undefined)
        if (revision === this.revision) this.update({ target, phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }).finally(() => {
      if (this.running === operation) { this.running = null; this.resume() }
    })
    this.running = operation
  }

  /** Acquire before HTTP, keep until stream completion/abort. Never switch an active turn. */
  async acquire(target: LocalEngineTarget, chatId?: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    if (key(target) !== key(this.target)) throw new Error('engineSelectionChanged')
    if (this.busy(chatId) || (this.leases && this.requestEngine !== target.engine)) throw new Error('engineBusy')
    const revision = this.revision
    if (this.state.phase === 'stopping') throw new Error('engineTransition')
    if (this.state.phase === 'error' && this.state.error === 'processInspectionFailed') {
      await waitForEngine(this.refresh(chatId), signal)
      signal?.throwIfAborted()
      if (revision !== this.revision) throw new Error('engineSelectionChanged')
    }
    if (this.state.phase === 'error') throw new Error(this.state.error || 'engineFailed')
    // Revalidate before every HTTP request; an idle child may have exited.
    if (!this.running) this.pending = true
    while (this.pending || this.running) {
      await waitForEngine(this.run(true), signal)
      signal?.throwIfAborted()
      if (revision !== this.revision) throw new Error('engineSelectionChanged')
    }
    signal?.throwIfAborted()
    if (revision !== this.revision) throw new Error('engineSelectionChanged')
    if (this.state.phase !== 'ready') throw new Error(this.state.error || 'engineFailed')
    this.leases++
    this.requestEngine = target.engine
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal?.removeEventListener('abort', release)
      this.leases--
      if (!this.leases) this.requestEngine = null
      this.resume()
    }
    signal?.addEventListener('abort', release, { once: true })
    return release
  }
}

function waitForEngine(operation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return operation
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export const localEngineCoordinator = new LocalEngineCoordinator()
