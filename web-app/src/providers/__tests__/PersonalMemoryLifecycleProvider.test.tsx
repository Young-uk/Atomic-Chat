import { useMessages } from '@/hooks/useMessages'
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
  useMessages.setState({ messages: {} })
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

it('delivers a persisted completed turn even when the transport completion callback was missed', async () => {
  useMessages.getState().setMessages('thread', [
    { id: 'u', thread_id: 'thread', role: 'user', created_at: Date.now(), content: [{ type: 'text', text: { value: 'Please verify results.' } }] },
    { id: 'a', thread_id: 'thread', role: 'assistant', created_at: Date.now(), metadata: { finishReason: 'stop' }, content: [{ type: 'text', text: { value: 'Verified.' } }] },
  ] as never)
  const view = render(<PersonalMemoryLifecycleProvider />)
  await waitFor(() => expect(mocks.call.mock.calls.some(call => call[0].arguments.action === 'observe')).toBe(true))
  const observation = mocks.call.mock.calls.find(call => call[0].arguments.action === 'observe')![0].arguments
  expect(observation).toMatchObject({ sessionId: 'thread', messageId: 'a', cacheOwner: 'thread/u', userMessage: 'Please verify results.', assistantReply: 'Verified.', turnCount: 1 })
  expect(observation.evidence.map((row: { id: string }) => row.id)).toEqual(['u', 'a'])
  mocks.listeners.forEach(listener => listener())
  await waitFor(() => expect(mocks.call.mock.calls.filter(call => call[0].arguments.action === 'observe')).toHaveLength(1))
  view.unmount()
})
