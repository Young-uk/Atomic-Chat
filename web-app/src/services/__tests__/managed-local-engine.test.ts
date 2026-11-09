import { describe, expect, it, vi } from 'vitest'
import {
  LocalEngineCoordinator, localEngineTarget, STRATA_MODEL, STRATA_PROVIDER,
  type LocalEngineSnapshot, type LocalEngineState, type LocalEngineTarget,
} from '../managed-local-engine'

const dstar: LocalEngineTarget = { engine: 'dstar', provider: 'Dstar', model: 'qwen-chat' }
const strata: LocalEngineTarget = { engine: 'strata', provider: STRATA_PROVIDER, model: STRATA_MODEL }
const snapshot = (target = dstar, status: LocalEngineSnapshot['status'] = 'ready'): LocalEngineSnapshot => ({
  engine: target.engine, status, owned: true, servedModels: [target.model],
})
const provider = (base_url: string, name = STRATA_PROVIDER) => ({
  provider: name, base_url, active: true, models: [{ id: STRATA_MODEL }] as Model[],
})
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('registered managed endpoint identity', () => {
  it('accepts only registered loopback service routes/models', () => {
    expect(localEngineTarget(provider('http://127.0.0.1:18080/v1'), { id: STRATA_MODEL })?.engine).toBe('strata')
    expect(localEngineTarget(provider('http://localhost:8010/v1'), { id: STRATA_MODEL })?.engine).toBe('dstar')
    expect(localEngineTarget(provider('http://[::1]:18080/v1'), { id: STRATA_MODEL })).toBeNull()
    expect(localEngineTarget(provider('http://127.0.0.1:18080/v1', 'unregistered'), { id: STRATA_MODEL })).toBeNull()
    expect(localEngineTarget(provider('http://127.0.0.1:18080/v1'), { id: 'other-model' })).toBeNull()
  })
  it('never grants the historical IQ2 profile lifecycle privileges', () => {
    const legacy = {
      ...provider('http://127.0.0.1:18080/v1', 'Strata · IQ2_XS test'),
      models: [{ id: 'ista-iq2-xs-local-compatibility-test' }] as Model[],
    }
    expect(localEngineTarget(legacy, legacy.models[0])).toBeNull()
    expect(STRATA_PROVIDER).toBe('Strata · ISTA IQ3_XXS')
    expect(STRATA_MODEL).toBe('ista-iq3-xxs')
  })
  it.each(['https://127.0.0.1:18080/v1', 'http://127.0.0.1.evil:18080/v1', 'http://192.168.1.1:18080/v1', 'http://127.0.0.1:18081/v1', 'http://user@localhost:8010/v1', 'http://localhost:8010/admin', 'http://localhost:8010/v1?redirect=remote', 'not a URL'])(
    'never manages %s', url => expect(localEngineTarget(provider(url), { id: STRATA_MODEL })).toBeNull()
  )
})

describe('local engine selection coordinator', () => {
  it.each([dstar, strata])('restores $engine at startup only when preload is enabled', async target => {
    const control = vi.fn().mockResolvedValue(snapshot(target))
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.selectEngineTarget(target, false)
    await flush()
    expect(control).not.toHaveBeenCalled()
    // Rehydration/provider refresh of the same selection is not a user start.
    coordinator.selectEngineTarget({ ...target })
    expect(control).not.toHaveBeenCalled()
    coordinator.startSelected(target)
    await flush()
    expect(control).toHaveBeenCalledExactlyOnceWith('ensure', target.engine)
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ready', target }))
    const preload = new LocalEngineCoordinator(control)
    preload.selectEngineTarget(target, true)
    await flush()
    expect(control).toHaveBeenCalledTimes(2)
  })

  it('coalesces rapid toggles and never publishes a stale success or failure', async () => {
    const old = deferred<LocalEngineSnapshot>()
    const control = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(snapshot(strata))
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state))
    coordinator.selectEngineTarget(dstar)
    coordinator.selectEngineTarget(strata)
    coordinator.selectEngineTarget(dstar)
    coordinator.selectEngineTarget(strata)
    const marker = states.length
    old.reject(new Error('old failure'))
    await flush()
    expect(control.mock.calls).toEqual([['ensure', 'dstar'], ['ensure', 'strata']])
    expect(states.slice(marker).every(state => state.target?.engine === 'strata' && state.phase !== 'error')).toBe(true)
    expect(states.at(-1)?.phase).toBe('ready')
  })

  it('defers while a reply or tools are active, then applies only the final choice', async () => {
    let busy = true
    const control = vi.fn().mockResolvedValue(snapshot(strata))
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.configureBusy(() => busy)
    coordinator.selectEngineTarget(dstar)
    coordinator.selectEngineTarget(strata)
    expect(control).not.toHaveBeenCalled()
    expect(publish).toHaveBeenLastCalledWith({ target: strata, phase: 'waiting' })
    busy = false
    coordinator.resume()
    await flush()
    expect(control).toHaveBeenCalledExactlyOnceWith('ensure', 'strata')
  })

  it('holds a generation lease until release, and revalidates readiness before HTTP', async () => {
    const control = vi.fn().mockImplementation((_action, engine) => Promise.resolve(snapshot(engine === 'strata' ? strata : dstar)))
    const coordinator = new LocalEngineCoordinator(control)
    coordinator.selectEngineTarget(dstar)
    await flush()
    const release = await coordinator.acquire(dstar)
    expect(control).toHaveBeenCalledTimes(2)
    coordinator.selectEngineTarget(strata)
    await flush()
    expect(control).toHaveBeenCalledTimes(2)
    release(); release()
    await flush()
    expect(control).toHaveBeenLastCalledWith('ensure', 'strata')
  })

  it('waits through stopping/loading until the selected model is served', async () => {
    const control = vi.fn().mockResolvedValueOnce(snapshot(dstar, 'stopping'))
      .mockResolvedValueOnce(snapshot(strata, 'loading')).mockResolvedValue(snapshot(strata))
    const coordinator = new LocalEngineCoordinator(control, vi.fn(), async () => {})
    coordinator.selectEngineTarget(strata)
    const release = await coordinator.acquire(strata)
    expect(control.mock.calls).toEqual([['ensure', 'strata'], ['status', 'strata'], ['status', 'strata']])
    release()
  })

  it('does not replay failures on provider refresh or busy updates; explicit retry recovers', async () => {
    const control = vi.fn().mockRejectedValueOnce(new Error('engineBusy')).mockResolvedValue(snapshot(strata))
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.selectEngineTarget(strata)
    await flush()
    coordinator.selectEngineTarget({ ...strata }); coordinator.resume()
    await expect(coordinator.acquire(strata)).rejects.toThrow('engineBusy')
    expect(control).toHaveBeenCalledTimes(1)
    coordinator.retry()
    await flush()
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ready' }))
  })

  it('does not start or stop remote providers, nor show stale local status', async () => {
    const old = deferred<LocalEngineSnapshot>()
    const control = vi.fn().mockReturnValue(old.promise)
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.selectEngineTarget(dstar)
    coordinator.selectEngineTarget(null)
    old.resolve(snapshot(dstar))
    await flush()
    expect(control).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenLastCalledWith({ target: null, phase: 'idle' })
  })

  it('rejects a stale send after a newer selection instead of routing it to the new engine', async () => {
    const old = deferred<LocalEngineSnapshot>()
    const control = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(snapshot(strata))
    const coordinator = new LocalEngineCoordinator(control)
    coordinator.selectEngineTarget(dstar)
    const request = coordinator.acquire(dstar)
    const assertion = expect(request).rejects.toThrow('engineSelectionChanged')
    coordinator.selectEngineTarget(strata)
    old.resolve(snapshot(dstar))
    await assertion
    await flush()
    expect(control).toHaveBeenLastCalledWith('ensure', 'strata')
  })

  it('abort cancels a waiting send immediately without cancelling a shared engine start', async () => {
    const start = deferred<LocalEngineSnapshot>()
    const control = vi.fn().mockReturnValue(start.promise)
    const coordinator = new LocalEngineCoordinator(control)
    coordinator.selectEngineTarget(strata)
    const abort = new AbortController()
    const request = coordinator.acquire(strata, 'chat', abort.signal)
    abort.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    start.resolve(snapshot(strata))
    await flush()
    expect(control).toHaveBeenCalledTimes(1)
  })

  it('explicit cancel waits for outstanding IPC, then stops once without auto-restarting', async () => {
    const start = deferred<LocalEngineSnapshot>()
    const control = vi.fn().mockReturnValueOnce(start.promise).mockResolvedValue(snapshot(strata, 'stopped'))
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.selectEngineTarget(strata)
    coordinator.cancel()
    start.resolve(snapshot(strata, 'loading'))
    await flush()
    expect(control.mock.calls).toEqual([['ensure', 'strata'], ['stop', 'strata']])
    coordinator.resume()
    expect(control).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'idle' }))
  })

  it('refuses foreign engines and missing model aliases without sending a request', async () => {
    const control = vi.fn().mockResolvedValue({ ...snapshot(strata), servedModels: ['different'] })
    const coordinator = new LocalEngineCoordinator(control)
    coordinator.selectEngineTarget(strata)
    await flush()
    await expect(coordinator.acquire(strata)).rejects.toThrow('modelNotServed')
    control.mockResolvedValue(snapshot(strata, 'external'))
    coordinator.retry()
    await flush()
    await expect(coordinator.acquire(strata)).rejects.toThrow('foreignEngine')
  })
})

it('cancels the desired engine while the previous engine is still stopping', async () => {
  const pause = deferred<void>()
  const control = vi.fn().mockResolvedValueOnce(snapshot(dstar, 'stopping')).mockResolvedValueOnce(snapshot(dstar, 'stopping')).mockResolvedValue(snapshot(dstar, 'stopped'))
  const publish = vi.fn()
  const coordinator = new LocalEngineCoordinator(control, publish, () => pause.promise)
  coordinator.selectEngineTarget(strata)
  await flush()
  coordinator.cancel()
  pause.resolve()
  await flush()
  // Native stop understands a queued target and clears it without replacing
  // the draining child. The old ready/loading snapshot must not restore UI.
  expect(control.mock.calls).toEqual([['ensure', 'strata'], ['stop', 'strata'], ['status', 'strata']])
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ target: strata, phase: 'idle' }))
})

it('fails closed before launching if a built-in model is still loaded', async () => {
  const control = vi.fn()
  const publish = vi.fn()
  const prepare = vi.fn().mockRejectedValue(new Error('otherLocalEngine'))
  const coordinator = new LocalEngineCoordinator(control, publish)
  coordinator.configurePrepare(prepare)
  coordinator.selectEngineTarget(strata)
  await flush()
  expect(control).not.toHaveBeenCalled()
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', error: 'otherLocalEngine' }))
  prepare.mockResolvedValue(undefined)
  control.mockResolvedValue(snapshot(strata))
  coordinator.retry()
  await flush()
  expect(control).toHaveBeenCalledExactlyOnceWith('ensure', 'strata')
})

it('reflects legacy panel starts, reloads and stops without starting anything itself', async () => {
  const control = vi.fn().mockResolvedValue(snapshot(dstar))
  const publish = vi.fn()
  const coordinator = new LocalEngineCoordinator(control, publish)
  coordinator.selectEngineTarget(dstar, false)
  for (const status of ['ready', 'loading', 'stopping', 'stopped'] as const) {
    control.mockResolvedValue(snapshot(dstar, status))
    await coordinator.refresh()
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: status === 'stopped' ? 'idle' : status }))
  }
  expect(control.mock.calls.every(([action]) => action === 'status')).toBe(true)
})


describe('summary rollback transition barrier', () => {
  it('waits for actual rollback before ensuring the new engine', async () => {
    const rollback = deferred<void>()
    const control = vi.fn().mockResolvedValue(snapshot(dstar))
    const coordinator = new LocalEngineCoordinator(control)
    coordinator.configureTransition({ quiesce: () => rollback.promise, resume: vi.fn() })
    coordinator.selectEngineTarget(dstar)
    await flush()
    expect(control).not.toHaveBeenCalled()
    rollback.resolve()
    await flush()
    expect(control).toHaveBeenCalledExactlyOnceWith('ensure', 'dstar')
  })

  it('returns to the original engine during rollback without stopping it for the stale choice', async () => {
    const rollback = deferred<void>()
    const control = vi.fn().mockResolvedValue(snapshot(strata))
    const resume = vi.fn().mockResolvedValue(undefined)
    const quiesce = vi.fn().mockReturnValueOnce(rollback.promise).mockResolvedValue(undefined)
    const coordinator = new LocalEngineCoordinator(control)
    coordinator.configureTransition({ quiesce, resume })
    coordinator.selectEngineTarget(dstar)
    await flush()
    coordinator.selectEngineTarget(strata)
    rollback.resolve()
    await flush()
    expect(resume).toHaveBeenCalledOnce()
    expect(control).toHaveBeenCalledExactlyOnceWith('ensure', 'strata')
  })

  it('Cancel during rollback releases drain without stopping the previous engine', async () => {
    const rollback = deferred<void>()
    const control = vi.fn()
    const resume = vi.fn().mockResolvedValue(undefined)
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.configureTransition({ quiesce: () => rollback.promise, resume })
    coordinator.selectEngineTarget(dstar)
    await flush()
    coordinator.cancel()
    rollback.resolve()
    await flush()
    expect(resume).toHaveBeenCalledOnce()
    expect(control).not.toHaveBeenCalled()
    expect(publish).toHaveBeenLastCalledWith({ target: dstar, phase: 'idle' })
  })

  it('fails closed on rollback or foreground refusal without calling ensure', async () => {
    const control = vi.fn()
    const publish = vi.fn()
    const coordinator = new LocalEngineCoordinator(control, publish)
    coordinator.configureTransition({ quiesce: vi.fn().mockRejectedValue(new Error('engineBusy')), resume: vi.fn().mockResolvedValue(undefined) })
    coordinator.selectEngineTarget(dstar)
    await flush()
    expect(control).not.toHaveBeenCalled()
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', error: 'engineBusy' }))
  })

  it('releases drain if native ensure refuses the new engine', async () => {
    const control = vi.fn().mockRejectedValue(new Error('missingRuntime'))
    let admissionDraining = false
    const states: LocalEngineState[] = []
    const resume = vi.fn(async () => { admissionDraining = false })
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state))
    coordinator.configureTransition({
      quiesce: vi.fn(async () => { admissionDraining = true }),
      resume,
    })
    coordinator.selectEngineTarget(dstar)
    await coordinator.settled()
    expect(resume).toHaveBeenCalledOnce()
    expect(admissionDraining).toBe(false)
    expect(states.at(-1)).toEqual({ target: dstar, phase: 'error', error: 'missingRuntime' })
  })
})


it('Cancel before quiesce starts does not stop the still-serving previous engine', async () => {
  const preparation = deferred<void>()
  let served = snapshot(strata)
  const states: LocalEngineState[] = []
  const control = vi.fn(async (action: string, engine: string | null) => {
    if (action === 'ensure') served = snapshot(engine === 'strata' ? strata : dstar)
    if (action === 'stop') served = { ...served, status: 'stopped', servedModels: [] }
    return served
  })
  const quiesce = vi.fn()
  const coordinator = new LocalEngineCoordinator(control, state => states.push(state))
  coordinator.selectEngineTarget(strata)
  await coordinator.settled()
  expect(states.at(-1)).toEqual({ target: strata, phase: 'ready', snapshot: snapshot(strata) })
  control.mockClear()

  coordinator.configurePrepare(() => preparation.promise)
  coordinator.configureTransition({ quiesce, resume: vi.fn() })
  coordinator.selectEngineTarget(dstar)
  expect(states.at(-1)).toEqual({ target: dstar, phase: 'loading' })
  coordinator.cancel()
  expect(states.at(-1)).toEqual({ target: dstar, phase: 'stopping' })
  preparation.resolve()
  await coordinator.settled()
  expect(states.at(-1)).toEqual({ target: dstar, phase: 'idle' })
  expect(quiesce).not.toHaveBeenCalled()
  expect(control).not.toHaveBeenCalled()
  expect(served).toEqual(snapshot(strata))

  // Cancel retains the selected intent without launching it or hiding the
  // still-serving old engine. Neither resume nor a status refresh restarts it.
  coordinator.resume()
  await coordinator.refresh()
  expect(control).toHaveBeenCalledExactlyOnceWith('status', 'dstar')
  expect(states.at(-1)).toEqual({ target: dstar, phase: 'idle', snapshot: snapshot(strata) })
  expect(served).toEqual(snapshot(strata))
})

describe('explicit endpoint recovery reconciliation', () => {
  it.each([dstar, strata])('recovers the same selected $engine without a second start or configuration change', async target => {
    const control = vi.fn().mockRejectedValueOnce(new Error('engineSummaryRecoveryRequired'))
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state))
    coordinator.selectEngineTarget(target)
    await coordinator.settled()
    expect(states.at(-1)?.phase).toBe('error')
    control.mockResolvedValue(snapshot(target))
    const callsBeforeReconcile = control.mock.calls.length
    expect(coordinator.reconcileReady(target, snapshot(target))).toBe(true)
    expect(control.mock.calls.length).toBe(callsBeforeReconcile)
    expect(states.at(-1)).toEqual({ target, phase: 'ready', snapshot: snapshot(target) })
    const release = await coordinator.acquire(target)
    expect(states.at(-1)?.phase).toBe('ready')
    expect(release).toBeTypeOf('function')
    release()
  })

  it.each([
    { owned: false },
    { engine: 'dstar' as const },
    { status: 'loading' as const },
    { servedModels: ['other-model'] },
    { error: 'engineSummaryRecoveryRequired' },
  ])('refuses an unverified recovery snapshot %j', async extra => {
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(vi.fn(), state => states.push(state))
    coordinator.selectEngineTarget(strata, false)
    expect(coordinator.reconcileReady(strata, { ...snapshot(strata), ...extra })).toBe(false)
    expect(states.at(-1)?.phase).toBe('idle')
  })

  it('refuses stale selection and cannot bypass an active start or foreground lease', async () => {
    const pending = deferred<LocalEngineSnapshot>()
    const coordinator = new LocalEngineCoordinator(vi.fn().mockReturnValue(pending.promise), () => {})
    coordinator.selectEngineTarget(strata)
    expect(coordinator.reconcileReady(strata, snapshot(strata))).toBe(false)
    pending.resolve(snapshot(strata))
    await coordinator.settled()
    expect(coordinator.reconcileReady(dstar, snapshot(dstar))).toBe(false)
    const release = await coordinator.acquire(strata)
    expect(coordinator.reconcileReady(strata, snapshot(strata))).toBe(false)
    release()
    expect(coordinator.reconcileReady(strata, snapshot(strata))).toBe(true)
  })
})

describe('transient ownership inspection recovery', () => {
  it.each([dstar, strata])('rechecks $engine status without restarting after a transient inspection failure', async target => {
    const control = vi.fn().mockResolvedValueOnce({ ...snapshot(target, 'error'), error: 'processInspectionFailed', servedModels: [] })
      .mockResolvedValue(snapshot(target))
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state), async () => {})
    coordinator.selectEngineTarget(target)
    await coordinator.settled()
    expect(states.at(-1)?.phase).toBe('ready')
    expect(control.mock.calls).toEqual([['ensure', target.engine], ['status', target.engine]])
  })

  it.each([dstar, strata])('allows $engine background status polling to recover the inspection error', async target => {
    const control = vi.fn().mockResolvedValue(snapshot(target))
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state))
    coordinator.selectEngineTarget(target); await coordinator.settled()
    control.mockResolvedValueOnce({ ...snapshot(target, 'error'), error: 'processInspectionFailed', servedModels: [] })
    await coordinator.refresh()
    expect(states.at(-1)?.error).toBe('processInspectionFailed')
    await coordinator.refresh()
    expect(states.at(-1)?.phase).toBe('ready')
    expect(control.mock.calls.filter(([action]) => action === 'ensure')).toHaveLength(1)
  })

  it.each([dstar, strata])('revalidates a retry from the current $engine chat instead of replaying a latched error', async target => {
    const control = vi.fn().mockResolvedValue({ ...snapshot(target, 'error'), error: 'processInspectionFailed', servedModels: [] })
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state), async () => {})
    coordinator.selectEngineTarget(target); await coordinator.settled()
    expect(control).toHaveBeenCalledTimes(3)
    coordinator.configureBusy(chatId => chatId !== 'current-chat')
    control.mockResolvedValue(snapshot(target))
    const release = await coordinator.acquire(target, 'current-chat')
    expect(states.at(-1)?.phase).toBe('ready')
    expect(control.mock.calls[3]).toEqual(['status', target.engine])
    release()
  })

  it.each([{ owned: false }, { error: 'foreignEngine', status: 'external' as const },
    { error: 'engineSummaryRecoveryRequired', status: 'error' as const }])('does not turn an unverified or sticky snapshot into readiness: %j', async extra => {
    const control = vi.fn().mockResolvedValue({ ...snapshot(strata, 'error'), error: 'processInspectionFailed', servedModels: [] })
    const states: LocalEngineState[] = []
    const coordinator = new LocalEngineCoordinator(control, state => states.push(state), async () => {})
    coordinator.selectEngineTarget(strata); await coordinator.settled()
    control.mockResolvedValue({ ...snapshot(strata), ...extra })
    await coordinator.refresh()
    expect(states.at(-1)?.phase).toBe('error')
    await expect(coordinator.acquire(strata)).rejects.toThrow()
  })
})

it.each([dstar, strata])('joins an in-flight $engine ownership recheck before retrying the chat', async target => {
  const control = vi.fn().mockResolvedValue({ ...snapshot(target, 'error'), error: 'processInspectionFailed' })
  const coordinator = new LocalEngineCoordinator(control, vi.fn(), async () => {})
  coordinator.selectEngineTarget(target); await coordinator.settled()
  const pending = deferred<LocalEngineSnapshot>()
  control.mockReturnValueOnce(pending.promise).mockResolvedValue(snapshot(target))
  const poll = coordinator.refresh()
  let acquired = false
  const request = coordinator.acquire(target).then(release => { acquired = true; return release })
  await flush()
  expect(acquired).toBe(false)
  expect(control).toHaveBeenCalledTimes(4)
  pending.resolve(snapshot(target))
  await poll
  const release = await request
  expect(acquired).toBe(true)
  release()
})
