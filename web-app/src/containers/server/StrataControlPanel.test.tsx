import { finishStrataStatusAction } from '@/hooks/useStrataEndpointStatus'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { StrataControlPanel } from './StrataControlPanel'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatSessions } from '@/stores/chat-session-store'
import { controlLocalEngine, localEngineCoordinator, STRATA_MODEL, STRATA_PROVIDER } from '@/services/managed-local-engine'

vi.mock('@tauri-apps/api/core', async original => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()), invoke: vi.fn(),
}))
vi.mock('@/services/managed-local-engine', async original => ({
  ...(await original<typeof import('@/services/managed-local-engine')>()),
  controlLocalEngine: vi.fn(),
}))
const model = { id: STRATA_MODEL, settings: {} } as Model
const provider = { provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', models: [model], settings: [], api_key: '' } as ModelProvider
const stopped = { engine: null, status: 'stopped', owned: false, servedModels: [] } as const
const ready = { engine: 'strata', status: 'ready', owned: true, servedModels: [STRATA_MODEL] } as const
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
beforeEach(() => {
  vi.stubGlobal('IS_MACOS', true); vi.stubGlobal('IS_TAURI', true)
  vi.useFakeTimers()
  useModelProvider.setState({ selectedProvider: 'other', selectedModel: null, providers: [provider] })
  useChatSessions.setState({ requestActive: {}, sessions: {} })
  vi.mocked(controlLocalEngine).mockReset().mockResolvedValue({ ...stopped, servedModels: [] })
  vi.spyOn(localEngineCoordinator, 'prepareStart').mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); finishStrataStatusAction(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('only reads status on mount and start explicitly selects Strata after verified readiness', async () => {
  render(<StrataControlPanel provider={provider} />); await flush()
  expect(controlLocalEngine).toHaveBeenCalledExactlyOnceWith('status', 'strata')
  expect(useModelProvider.getState().selectedProvider).toBe('other')
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels] })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' }))
  await flush()
  expect(controlLocalEngine).toHaveBeenCalledWith('ensure', 'strata', 65536)
  expect(localEngineCoordinator.prepareStart).toHaveBeenCalledOnce()
  expect(useModelProvider.getState().selectedProvider).toBe(STRATA_PROVIDER)
})
it('stops an owned Strata even when Dstar is selected without changing that selection', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels] })
  render(<StrataControlPanel provider={provider} />); await flush()
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [] })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.stop' }))
  await flush()
  expect(controlLocalEngine).toHaveBeenCalledWith('stop', 'strata')
  expect(useModelProvider.getState().selectedProvider).toBe('other')
})
it('disables lifecycle while a foreground reply or approval is active', async () => {
  useChatSessions.getState().setRequestActive('chat', true)
  render(<StrataControlPanel provider={provider} />); await flush()
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(controlLocalEngine).toHaveBeenCalledTimes(1)
})
it('does not show controls for an arbitrary renamed or remote provider', async () => {
  render(<StrataControlPanel provider={{ ...provider, provider: 'other' }} />); await flush()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(controlLocalEngine).not.toHaveBeenCalled()
})
it('keeps Stop available for an owned failed server and rejects repeated clicks', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, status: 'error', error: 'engineSummaryRecoveryRequired', servedModels: [] })
  render(<StrataControlPanel provider={provider} />); await flush()
  vi.mocked(controlLocalEngine).mockImplementation(() => new Promise(() => {}))
  const button = screen.getByRole('button', { name: 'endpoints:localEngine.stop' })
  fireEvent.click(button); fireEvent.click(button)
  expect(controlLocalEngine).toHaveBeenCalledTimes(2)
  expect(button).toBeDisabled()
})
it('never stops an unowned external listener', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, status: 'external', owned: false, servedModels: [] })
  render(<StrataControlPanel provider={provider} />); await flush()
  expect(screen.getByRole('button')).toBeDisabled()
})
it('drops a pending automatic selection after the user chooses another model', async () => {
  const view = render(<StrataControlPanel provider={provider} />); await flush()
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, status: 'loading', servedModels: [] })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  act(() => useModelProvider.setState({ selectedProvider: 'newer-choice' }))
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels] })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(useModelProvider.getState().selectedProvider).toBe('newer-choice')
  view.unmount()
  const calls = vi.mocked(controlLocalEngine).mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(controlLocalEngine).toHaveBeenCalledTimes(calls)
})

it('recovers an already-selected failed coordinator after panel Start and permits the next acquisition', async () => {
  const target = { engine: 'strata' as const, provider: STRATA_PROVIDER, model: STRATA_MODEL }
  useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: model })
  localEngineCoordinator.selectEngineTarget(null, false)
  vi.mocked(invoke).mockRejectedValueOnce(new Error('engineSummaryRecoveryRequired'))
  localEngineCoordinator.selectEngineTarget(target)
  await localEngineCoordinator.settled()
  vi.mocked(invoke).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels] })
  render(<StrataControlPanel provider={provider} />); await flush()
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels] })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' }))
  await flush()
  expect(screen.getByRole('button', { name: 'endpoints:localEngine.stop' })).toBeEnabled()
  let release!: () => void
  await act(async () => { release = await localEngineCoordinator.acquire(target) })
  expect(release).toBeTypeOf('function')
  release()
  act(() => localEngineCoordinator.selectEngineTarget(null, false))
})

it('does not auto-select a ready-shaped snapshot carrying an error', async () => {
  render(<StrataControlPanel provider={provider} />); await flush()
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], error: 'engineFailed' })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  expect(screen.getByRole('status')).toHaveTextContent('error')
  expect(useModelProvider.getState().selectedProvider).toBe('other')
})

it('loads the saved context and does not overwrite a pending edit during polling', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [], strataContext: 32768 })
  render(<StrataControlPanel provider={provider} />); await flush()
  const input = screen.getByRole('spinbutton')
  expect(input).toHaveValue(32768)
  fireEvent.change(input, { target: { value: '49152' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(input).toHaveValue(49152)
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  expect(controlLocalEngine).toHaveBeenCalledWith('ensure', 'strata', 49152)
})
it.each(['', '16383', '2147483647', '32768.5'])('rejects invalid context %s without starting', async value => {
  render(<StrataControlPanel provider={provider} />); await flush()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value } })
  expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })).toBeDisabled()
  expect(controlLocalEngine).toHaveBeenCalledExactlyOnceWith('status', 'strata')
})
it('requires restart confirmation and rechecks chat activity before applying', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], strataContext: 65536, activeContext: 65536 })
  render(<StrataControlPanel provider={provider} />); await flush()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '32768' } })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:dstar.restart' }))
  expect(controlLocalEngine).toHaveBeenCalledExactlyOnceWith('status', 'strata')
  const dialog = within(screen.getByRole('dialog'))
  act(() => useChatSessions.getState().setRequestActive('chat', true))
  expect(dialog.getByRole('button', { name: 'endpoints:dstar.restart' })).toBeDisabled()
  act(() => useChatSessions.getState().setRequestActive('chat', false))
  fireEvent.click(dialog.getByRole('button', { name: 'endpoints:dstar.restart' })); await flush()
  expect(controlLocalEngine).toHaveBeenCalledWith('ensure', 'strata', 32768)
})
it('preserves the local draft after a failed apply', async () => {
  render(<StrataControlPanel provider={provider} />); await flush()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '32768' } })
  vi.mocked(controlLocalEngine).mockRejectedValueOnce(new Error('engineFailed'))
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  expect(screen.getByRole('alert')).toBeInTheDocument()
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [], strataContext: 65536 })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('spinbutton')).toHaveValue(32768)
})
it('tracks external saved changes while untouched, but keeps an actual local edit', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [], strataContext: 65536 })
  render(<StrataControlPanel provider={provider} />); await flush()
  const input = screen.getByRole('spinbutton')
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [], strataContext: 32768 })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(input).toHaveValue(32768)
  fireEvent.change(input, { target: { value: '49152' } })
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [], strataContext: 16384 })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(input).toHaveValue(49152)
})
it('marks an accepted apply clean so subsequent saved changes synchronize again', async () => {
  render(<StrataControlPanel provider={provider} />); await flush()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '32768' } })
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], strataContext: 32768, activeContext: 32768 })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  expect(screen.getByRole('spinbutton')).toHaveValue(32768)
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], strataContext: 49152, activeContext: 32768 })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('spinbutton')).toHaveValue(49152)
  expect(screen.getByRole('button', { name: 'endpoints:dstar.restart' })).toBeEnabled()
})
it('polls saved and active settings after a persisted setting fails to launch', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], strataContext: 65536, activeContext: 65536 })
  render(<StrataControlPanel provider={provider} />); await flush()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '32768' } })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:dstar.restart' }))
  vi.mocked(controlLocalEngine).mockRejectedValueOnce(new Error('strataContextPinMismatch'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'endpoints:dstar.restart' })); await flush()
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], strataContext: 32768, activeContext: 65536 })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('spinbutton')).toHaveValue(32768)
  expect(screen.getByText('endpoints:localEngine.savedContext')).toBeInTheDocument()
  expect(screen.getByText('endpoints:localEngine.activeContext')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'endpoints:dstar.restart' })).toBeEnabled()
})
it('does not restore an older saved context when a pre-apply poll arrives late', async () => {
  render(<StrataControlPanel provider={provider} />); await flush()
  let finishOldPoll!: (value: Awaited<ReturnType<typeof controlLocalEngine>>) => void
  vi.mocked(controlLocalEngine).mockImplementationOnce(() => new Promise(resolve => { finishOldPoll = resolve }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '32768' } })
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: [...ready.servedModels], strataContext: 32768, activeContext: 32768 })
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  await act(async () => { finishOldPoll({ ...stopped, servedModels: [], strataContext: 65536 }); await Promise.resolve() })
  expect(screen.getByRole('spinbutton')).toHaveValue(32768)
  expect(screen.queryByRole('button', { name: 'endpoints:dstar.restart' })).not.toBeInTheDocument()
})

it.each([65537, 131072, 1048576])('accepts a user context above the former 64K cap: %s', async context => {
  render(<StrataControlPanel provider={provider} />); await flush()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: String(context) } })
  expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })); await flush()
  expect(controlLocalEngine).toHaveBeenLastCalledWith('ensure', 'strata', context)
})

it('keeps the slider and context input synchronized using model metadata', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...stopped, servedModels: [], maxContext: 262144, context: 65536 })
  render(<StrataControlPanel provider={provider} />); await flush()
  const slider = screen.getByRole('slider')
  expect(slider).toHaveAttribute('max', '262144')
  fireEvent.change(slider, { target: { value: '131072' } })
  expect(screen.getByRole('spinbutton')).toHaveValue(131072)
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '98304' } })
  expect(slider).toHaveValue('98304')
  expect(controlLocalEngine).toHaveBeenCalledTimes(1)
})
