import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EndpointCard } from './EndpointCard'
import { StrataControlPanel } from '../server/StrataControlPanel'
import { beginStrataStatusAction, finishStrataStatusAction } from '@/hooks/useStrataEndpointStatus'
import { controlLocalEngine, STRATA_MODEL, STRATA_PROVIDER, useLocalEngine, type LocalEngineSnapshot } from '@/services/managed-local-engine'
import { useEndpointCheckStore } from '@/stores/endpoint-check-store'
vi.mock('@/services/managed-local-engine', async original => ({ ...(await original<typeof import('@/services/managed-local-engine')>()), controlLocalEngine: vi.fn() }))
const provider = { provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', models: [{ id: STRATA_MODEL }], settings: [], api_key: '' } as ModelProvider
const ready: LocalEngineSnapshot = { engine: 'strata', status: 'ready', owned: true, servedModels: [STRATA_MODEL] }
const stopped: LocalEngineSnapshot = { engine: null, status: 'stopped', owned: false, servedModels: [] }
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
function card(p = provider, controls = false) { return <EndpointCard provider={p} expanded={false} onToggleExpanded={() => {}} onConnectMedia={() => {}} onPing={() => {}} onConfigure={() => {}} serverControls={controls ? <StrataControlPanel provider={p} /> : undefined} /> }
beforeEach(() => {
  vi.stubGlobal('IS_MACOS', true); vi.stubGlobal('IS_TAURI', true); vi.useFakeTimers()
  useLocalEngine.setState({ target: null, phase: 'idle' }, true)
  vi.mocked(controlLocalEngine).mockReset().mockResolvedValue(stopped)
  useEndpointCheckStore.setState({ results: { [STRATA_PROVIDER]: { ok: true, modelCount: 1, latencyMs: 1 } }, checking: {} })
})
afterEach(() => { cleanup(); finishStrataStatusAction(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('ignores cached/manual success and shares one read-only poll with controls', async () => {
  render(card(provider, true)); await flush()
  expect(controlLocalEngine).toHaveBeenCalledExactlyOnceWith('status', 'strata')
  expect(screen.getAllByRole('status').every(node => node.textContent?.includes('stopped'))).toBe(true)
  act(() => useEndpointCheckStore.getState().setResult(STRATA_PROVIDER, { ok: true, modelCount: 1, latencyMs: 9 }))
  expect(screen.queryByText(/reachable|connected/)).not.toBeInTheDocument()
})
it('invalidates ready immediately on Stop and rejects an older status reply', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue(ready)
  render(card(provider, true)); await flush()
  let resolve!: (value: LocalEngineSnapshot) => void
  vi.mocked(controlLocalEngine).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  vi.mocked(controlLocalEngine).mockResolvedValue(stopped)
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.stop' })); await flush()
  await act(async () => resolve(ready))
  expect(screen.getAllByRole('status').every(node => node.textContent?.includes('stopped'))).toBe(true)
})
it('clears ready after polling failure and recovers on a later read', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue(ready)
  render(card()); await flush()
  vi.mocked(controlLocalEngine).mockRejectedValueOnce(new Error('unavailable'))
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('status')).toHaveTextContent('unverified')
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('status')).toHaveTextContent('ready')
})
it('checks inactive registered providers but never probes an arbitrary address', async () => {
  const view = render(card({ ...provider, active: false })); await flush()
  expect(screen.getByRole('status')).toHaveTextContent('stopped')
  view.rerender(card({ ...provider, base_url: 'https://example.com/v1' })); await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(controlLocalEngine).toHaveBeenCalledTimes(1)
})
it.each([
  [{ ...ready, engine: 'dstar' }, 'stopped'],
  [{ ...ready, status: 'external', owned: false }, 'external'],
  [{ ...ready, servedModels: ['wrong-model'] }, 'unverified'],
  [{ ...stopped, error: 'failed', status: 'error' }, 'error'],
] as [LocalEngineSnapshot, string][])('uses lifecycle identity %s', async (snapshot, label) => {
  vi.mocked(controlLocalEngine).mockResolvedValue(snapshot)
  render(card()); await flush()
  expect(screen.getByRole('status')).toHaveTextContent(label)
})
it('rechecks after switching engines and drops old replies across unmount/remount', async () => {
  let resolve!: (value: LocalEngineSnapshot) => void
  vi.mocked(controlLocalEngine).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = render(card()); await flush(); view.unmount()
  render(card()); await flush()
  await act(async () => { resolve(ready); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByRole('status')).toHaveTextContent('stopped')
  act(() => useLocalEngine.setState({ target: { engine: 'dstar', provider: 'dstar', model: 'model' }, phase: 'loading' }))
  await flush()
  expect(controlLocalEngine).toHaveBeenCalledTimes(3)
})
it('hides stale ready while backgrounded and rechecks on return', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue(ready)
  render(card()); await flush()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange')); await flush()
  expect(screen.getByRole('status')).toHaveTextContent('checking')
  vi.mocked(controlLocalEngine).mockResolvedValue(stopped)
  hidden.mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange')); await flush()
  expect(screen.getByRole('status')).toHaveTextContent('stopped')
  hidden.mockRestore()
})

it('bounds ready freshness without queueing more IPC behind a blocked native actor', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue(ready)
  render(card()); await flush()
  let resolve!: (snapshot: LocalEngineSnapshot) => void
  vi.mocked(controlLocalEngine).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(screen.getByRole('status')).toHaveTextContent('unverified')
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(controlLocalEngine).toHaveBeenCalledTimes(2)
  vi.mocked(controlLocalEngine).mockResolvedValue(stopped)
  await act(async () => { resolve(ready); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByRole('status')).toHaveTextContent('stopped')
})
it('does not flicker or requery for unchanged coordinator publications', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue(ready)
  render(card()); await flush()
  act(() => useLocalEngine.setState({ target: null, phase: 'idle' }, true))
  expect(screen.getByRole('status')).toHaveTextContent('ready')
  expect(controlLocalEngine).toHaveBeenCalledTimes(1)
})
it('header and controls agree when readiness identity is invalid', async () => {
  vi.mocked(controlLocalEngine).mockResolvedValue({ ...ready, servedModels: ['wrong'] })
  render(card(provider, true)); await flush()
  expect(screen.getAllByRole('status').every(node => node.textContent?.includes('unverified'))).toBe(true)
})

it('expires action Ready even when an older status request remains blocked', async () => {
  let resolve!: (snapshot: LocalEngineSnapshot) => void
  vi.mocked(controlLocalEngine).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(card()); await flush()
  act(() => { beginStrataStatusAction('loading'); finishStrataStatusAction(ready) })
  expect(screen.getByRole('status')).toHaveTextContent('ready')
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(screen.getByRole('status')).toHaveTextContent('unverified')
  expect(controlLocalEngine).toHaveBeenCalledTimes(1)
  vi.mocked(controlLocalEngine).mockResolvedValue(stopped)
  await act(async () => { resolve(ready); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByRole('status')).toHaveTextContent('stopped')
})
it('expires focus Checking while an obsolete status request is blocked', async () => {
  let resolve!: (snapshot: LocalEngineSnapshot) => void
  vi.mocked(controlLocalEngine).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(card()); await flush()
  fireEvent(window, new Event('focus')); await flush()
  expect(screen.getByRole('status')).toHaveTextContent('checking')
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(screen.getByRole('status')).toHaveTextContent('unverified')
  expect(controlLocalEngine).toHaveBeenCalledTimes(1)
  vi.mocked(controlLocalEngine).mockResolvedValue(stopped)
  await act(async () => { resolve(ready); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByRole('status')).toHaveTextContent('stopped')
})
