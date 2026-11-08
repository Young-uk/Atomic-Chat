import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runAgentTurn, cancelAgentTurn } from '../tauri'
import { localEngineCoordinator, STRATA_MODEL, STRATA_PROVIDER } from '@/services/managed-local-engine'
import { useModelProvider } from '@/hooks/useModelProvider'
import { createAgentRunState, reduceAgentRunState } from '@/hooks/useAgentRun'
import type { AgentEvent, AgentTurnRequest } from '@/types/agent'
const mock = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', async original => ({ ...await original<typeof import('@tauri-apps/api/core')>(), invoke: mock.invoke, Channel: class { onmessage?: unknown } }))
const request: AgentTurnRequest = { run_id: 'test-run', session_id: 'test-thread', model_id: STRATA_MODEL, provider: STRATA_PROVIDER, user_message: 'test', auto_approve: false }
beforeEach(() => {
  vi.stubGlobal('IS_TAURI', true)
  const model = { id: STRATA_MODEL, settings: {} } as Model
  useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: model, providers: [{ provider: STRATA_PROVIDER, active: true, models: [model], settings: [], api_key: '', base_url: 'http://127.0.0.1:18080/v1' }] })
  mock.invoke.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('holds readiness and the engine lease through the complete native agent run', async () => {
  let ready!: (release: () => void) => void
  let finish!: () => void
  const release = vi.fn()
  vi.spyOn(localEngineCoordinator, 'acquire').mockImplementation(() => new Promise(resolve => { ready = resolve }))
  let state = createAgentRunState()
  mock.invoke.mockImplementation((_command, { onEvent }: { onEvent: { onmessage: (event: AgentEvent) => void } }) => new Promise<void>(resolve => {
    onEvent.onmessage({ type: 'turn_started', run_id: request.run_id, session_id: request.session_id })
    onEvent.onmessage({ type: 'assistant_delta', text: 'Ready to help.' })
    finish = () => {
      onEvent.onmessage({ type: 'turn_finished', reason: 'finish', step_count: 1 })
      resolve()
    }
  }))
  const run = runAgentTurn(request, event => { state = reduceAgentRunState(state, event) })
  expect(state.status).toBe('idle')
  expect(mock.invoke).not.toHaveBeenCalled()
  ready(release)
  await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('agent_run_turn', expect.objectContaining({ request })))
  expect(state.status).toBe('running')
  expect(state.trace.assistantText).toBe('Ready to help.')
  expect(release).not.toHaveBeenCalled()
  finish()
  await run
  expect(state.status).toBe('finished')
  expect(state.trace).toMatchObject({ assistantText: 'Ready to help.', stepCount: 1, finishReason: 'finish' })
  expect(release).toHaveBeenCalledOnce()
})
it('cancels a pending send without later invoking the native agent or reporting failure', async () => {
  let state = createAgentRunState()
  const onEvent = vi.fn((event: AgentEvent) => { state = reduceAgentRunState(state, event) })
  vi.spyOn(localEngineCoordinator, 'acquire').mockImplementation((_target, _id, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))))
  const run = runAgentTurn(request, onEvent)
  await cancelAgentTurn(request.run_id)
  await run
  expect(state.status).toBe('cancelled')
  expect(state.trace).toMatchObject({ assistantText: '', stepCount: 0, finishReason: 'cancelled' })
  expect(mock.invoke).not.toHaveBeenCalled()
  expect(onEvent).toHaveBeenCalledWith({ type: 'turn_finished', reason: 'cancelled', step_count: 0 })
})

it('exempts its own durable agent run while still refusing another running thread', async () => {
  const { LocalEngineCoordinator, localEngineTarget } = await import('@/services/managed-local-engine')
  const { isLocalEngineBusy } = await import('@/hooks/useLocalEngineBusy')
  const { useChatSessions } = await import('@/stores/chat-session-store')
  const { useAgentRun } = await import('@/hooks/useAgentRun')
  useChatSessions.setState({ sessions: {}, requestActive: {} })
  useAgentRun.getState().clearAll()
  const target = localEngineTarget(useModelProvider.getState().getProviderByName(STRATA_PROVIDER), { id: STRATA_MODEL })!
  const coordinator = new LocalEngineCoordinator(async () => ({ engine: 'strata', status: 'ready', owned: true, servedModels: [STRATA_MODEL] }))
  coordinator.configureBusy(isLocalEngineBusy)
  coordinator.selectEngineTarget(target, false)
  vi.spyOn(localEngineCoordinator, 'acquire').mockImplementation(coordinator.acquire.bind(coordinator))
  mock.invoke.mockImplementation(async (_command, { onEvent }: { onEvent: { onmessage: (event: AgentEvent) => void } }) => {
    onEvent.onmessage({ type: 'assistant_delta', text: '42' })
    onEvent.onmessage({ type: 'turn_finished', reason: 'finish', step_count: 1 })
  })
  useAgentRun.getState().startRun(request.session_id, request.run_id)
  try {
    await runAgentTurn(request, event => useAgentRun.getState().applyEvent(request.session_id, event))
    expect(useAgentRun.getState().getRun(request.session_id)).toMatchObject({ status: 'finished', trace: { assistantText: '42', stepCount: 1 } })
    useAgentRun.getState().startRun('another-durable-thread', 'other-run')
    await expect(coordinator.acquire(target, request.session_id)).rejects.toThrow('engineBusy')
    expect(useAgentRun.getState().getRun('another-durable-thread').status).toBe('running')
  } finally {
    useAgentRun.getState().clearAll()
    useChatSessions.setState({ sessions: {}, requestActive: {} })
    coordinator.selectEngineTarget(null)
  }
})
