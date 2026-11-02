import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ call: vi.fn(), chats: { requestActive: {} as Record<string, boolean>, sessions: {} as Record<string, unknown> }, summary: { byThread: {} as Record<string, unknown> }, listeners: [] as (() => void)[] }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service }))
const service = { mcp: () => ({ callTool: mocks.call }) }
vi.mock('@/hooks/useMCPServers', () => ({ useMCPServers: (select: (state: unknown) => unknown) => select({ mcpServers: { 'atomic-personal-tools': { active: true } } }) }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => mocks.chats, subscribe: (callback: () => void) => { mocks.listeners.push(callback); return () => {} } } }))
vi.mock('@/lib/context-summary-progress', () => ({ useContextSummaryProgress: { getState: () => mocks.summary, subscribe: (callback: () => void) => { mocks.listeners.push(callback); return () => {} } } }))
import { PersonalMemoryLifecycleProvider, personalMemoryMustPause } from '../PersonalMemoryLifecycleProvider'
beforeEach(() => {
  vi.stubEnv('VITE_PERSONAL_BUILD', 'true')
  mocks.listeners = []
  mocks.chats = { requestActive: {}, sessions: {} }
  mocks.summary = { byThread: {} }
  mocks.call.mockReset().mockResolvedValue({ content: [{ text: '{"phase":"idle"}' }] })
})
afterEach(() => vi.unstubAllEnvs())
it('immediately pauses background memory when chat starts and waits until summaries also finish', async () => {
  const view = render(<PersonalMemoryLifecycleProvider />)
  await waitFor(() => expect(mocks.call).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: { action: 'activity', busy: false } })))
  mocks.chats.requestActive.thread = true
  mocks.listeners.forEach(listener => listener())
  await waitFor(() => expect(mocks.call).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: { action: 'activity', busy: true } })))
  mocks.chats.requestActive.thread = false
  mocks.summary.byThread.thread = { phase: 'summarizing' }
  expect(personalMemoryMustPause()).toBe(true)
  mocks.summary.byThread.thread = { phase: 'ready' }
  mocks.listeners.forEach(listener => listener())
  await waitFor(() => expect(mocks.call).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: { action: 'activity', busy: false } })))
  view.unmount()
})
