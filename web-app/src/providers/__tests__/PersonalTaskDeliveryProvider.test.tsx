import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ call: vi.fn(), fetch: vi.fn(), create: vi.fn(), notify: vi.fn(), upsert: vi.fn(), set: vi.fn(), current: [] as unknown[], sessionMessages: [] as { id: string; role: string }[], receipts: [] as { error?: string; messageId?: string }[] }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service }))
const service = { mcp: () => ({ callTool: mocks.call }), messages: () => ({ fetchMessages: mocks.fetch, createMessage: mocks.create }) }
vi.mock('@/hooks/useMCPServers', () => ({ useMCPServers: (select: (state: unknown) => unknown) => select({ mcpServers: { 'atomic-personal-tools': { active: true } } }) }))
vi.mock('@/hooks/useMessages', () => ({ useMessages: { getState: () => ({ getMessages: () => mocks.current, setMessages: mocks.set }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ upsertMessage: mocks.upsert, sessions: { thread: { chat: { messages: mocks.sessionMessages } } } }) } }))
vi.mock('@/lib/thread-message-sync', () => ({ trackThreadMessageWrite: (_id: string, promise: Promise<unknown>) => promise }))
vi.mock('@/lib/personal-task-delivery', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/personal-task-delivery')>(), notifyScheduledResult: mocks.notify }))
import { PersonalTaskDeliveryProvider } from '../PersonalTaskDeliveryProvider'
import { scheduledResultMessage, scheduledMessagesForModel } from '@/lib/personal-task-delivery'
import type { UIMessage } from 'ai'
const row = { taskId: 'task', id: 'run', threadId: 'thread', finishedAt: 1793574012517, result: 'Synthetic reminder' }
beforeEach(() => {
  vi.stubEnv('VITE_PERSONAL_BUILD', 'true')
  vi.clearAllMocks()
  mocks.current = []
  mocks.sessionMessages = []
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
  mocks.fetch.mockReset().mockResolvedValue([scheduledResultMessage(row)])
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


it('displays and persists a reminder immediately with its unfinished user-turn anchor', async () => {
  mocks.sessionMessages = [{ id: 'active-user', role: 'user' }, { id: 'streaming-answer', role: 'assistant' }]
  const view = render(<PersonalTaskDeliveryProvider />)
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(row))
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({
    scheduled: true, scheduled_after_user_id: 'active-user', scheduled_order: row.finishedAt,
  }) }))
  expect(mocks.upsert).toHaveBeenCalledWith('thread', expect.objectContaining({ id: 'scheduled-run' }))
  expect(mocks.current).toEqual([expect.objectContaining({ id: 'scheduled-run', metadata: expect.objectContaining({ scheduled_after_user_id: 'active-user' }) })])
  view.unmount()
})
it('replays a saved delivery anchor on retry after the active user changes', async () => {
  const saved = scheduledResultMessage(row, 'original-user')
  mocks.fetch.mockReset().mockResolvedValue([saved])
  mocks.sessionMessages = [{ id: 'different-user', role: 'user' }]
  const view = render(<PersonalTaskDeliveryProvider />)
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(row))
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.upsert).toHaveBeenCalledWith('thread', expect.objectContaining({ metadata: expect.objectContaining({ scheduled_after_user_id: 'original-user' }) }))
  expect(mocks.current).toEqual([saved])
  view.unmount()
})
const user = (id: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text: id }] })
const answer = (id: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text: id }] })
const notice = (id: string, anchor: string, order = 1): UIMessage => ({ ...answer(id),
  metadata: { scheduled: true, scheduled_after_user_id: anchor, scheduled_order: order } })
it('keeps mid-turn reminders visible but outside live model continuations', () => {
  const messages = [user('u'), answer('tool-step'), notice('reminder', 'u'), answer('remaining-step')]
  const before = structuredClone(messages)
  expect(scheduledMessagesForModel(messages)).toEqual([messages[0], messages[1], messages[3]])
  expect(messages).toEqual(before)
})
it('reconstructs the same order on restart and admits reminders at the next user turn', () => {
  const u = user('u'), a = answer('whole-answer'), n = notice('reminder', 'u'), next = user('next')
  const expected = [u, a, n, next]
  expect(scheduledMessagesForModel([u, n, a, next])).toEqual(expected)
  expect(scheduledMessagesForModel([u, a, next, n])).toEqual(expected)
  expect(scheduledMessagesForModel(expected)).toEqual(expected)
})
it('keeps stable delivery order and leaves legacy and orphaned notices unchanged', () => {
  const u = user('u'), a = answer('a'), next = user('next'), first = notice('first', 'u', 1), second = notice('second', 'u', 2)
  expect(scheduledMessagesForModel([u, a, second, next, first])).toEqual([u, a, first, second, next])
  const legacy = { ...answer('legacy'), metadata: { scheduled: true } }, orphan = notice('orphan', 'deleted-user')
  const messages = [legacy, orphan, next]
  expect(scheduledMessagesForModel(messages)).toBe(messages)
})
