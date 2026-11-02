import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ call: vi.fn(), fetch: vi.fn(), create: vi.fn(), notify: vi.fn(), upsert: vi.fn(), set: vi.fn(), current: [] as unknown[], receipts: [] as { error?: string; messageId?: string }[] }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service }))
const service = { mcp: () => ({ callTool: mocks.call }), messages: () => ({ fetchMessages: mocks.fetch, createMessage: mocks.create }) }
vi.mock('@/hooks/useMCPServers', () => ({ useMCPServers: (select: (state: unknown) => unknown) => select({ mcpServers: { 'atomic-personal-tools': { active: true } } }) }))
vi.mock('@/hooks/useMessages', () => ({ useMessages: { getState: () => ({ getMessages: () => mocks.current, setMessages: mocks.set }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ upsertMessage: mocks.upsert }) } }))
vi.mock('@/lib/thread-message-sync', () => ({ trackThreadMessageWrite: (_id: string, promise: Promise<unknown>) => promise }))
vi.mock('@/lib/personal-task-delivery', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/personal-task-delivery')>(), notifyScheduledResult: mocks.notify }))
import { PersonalTaskDeliveryProvider } from '../PersonalTaskDeliveryProvider'
const row = { taskId: 'task', id: 'run', threadId: 'thread', finishedAt: 1793574012517, result: 'Synthetic reminder' }
beforeEach(() => {
  vi.stubEnv('VITE_PERSONAL_BUILD', 'true')
  vi.clearAllMocks()
  mocks.current = []
  mocks.receipts = []
  mocks.call.mockImplementation(async ({ arguments: args }) => {
    if (args.action === 'record') mocks.receipts.push(args)
    return { content: [{ text: JSON.stringify(args.action === 'pending' ? [row] : {}) }] }
  })
  mocks.set.mockImplementation((_thread, messages) => { mocks.current = messages })
  mocks.notify.mockResolvedValue(undefined)
  mocks.create.mockImplementation(async message => message)
  mocks.fetch.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'scheduled-run' }])
})
afterEach(() => vi.unstubAllEnvs())
it('persists and verifies the result, updates the existing chat, then submits an app notification', async () => {
  const view = render(<PersonalTaskDeliveryProvider />)
  await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ arguments: { action: 'record', taskId: 'task', runId: 'run', messageId: 'scheduled-run' } })))
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.upsert).toHaveBeenCalledWith('thread', expect.objectContaining({ id: 'scheduled-run' }))
  expect(mocks.notify).toHaveBeenCalledWith(row)
  expect(mocks.current).toEqual([expect.objectContaining({ id: 'scheduled-run', thread_id: 'thread' })])
  expect(mocks.receipts[0]).toMatchObject({ messageId: 'scheduled-run' })
  view.unmount()
})
it('records notification failure without duplicating an already saved message', async () => {
  mocks.fetch.mockReset().mockResolvedValue([{ id: 'scheduled-run' }])
  mocks.notify.mockRejectedValue(new Error('Synthetic OS permission failure'))
  const view = render(<PersonalTaskDeliveryProvider />)
  await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ arguments: expect.objectContaining({ action: 'record', error: 'Error: Synthetic OS permission failure' }) })))
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.receipts[0].error).toBe('Error: Synthetic OS permission failure')
  expect(mocks.current).toHaveLength(1)
  view.unmount()
})
it('does not acknowledge a storage adapter that failed to persist its optimistic result', async () => {
  mocks.fetch.mockReset().mockResolvedValue([])
  const view = render(<PersonalTaskDeliveryProvider />)
  await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ arguments: expect.objectContaining({ action: 'record', error: expect.stringContaining('could not be saved') }) })))
  expect(mocks.notify).not.toHaveBeenCalled()
  expect(mocks.current).toHaveLength(0)
  expect(mocks.receipts[0].error).toContain('could not be saved')
  view.unmount()
})
