import { afterEach, expect, it, vi } from 'vitest'
import { interruptWorkForEngineStop } from '../confirmed-engine-stop'
import { useChatSessions } from '@/stores/chat-session-store'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import type { ChatSession } from '@/stores/chat-session-store'

afterEach(() => { useChatSessions.setState({ sessions: {}, requestActive: {} }); vi.restoreAllMocks() })
it('aborts stuck tools, cancels the stream and pauses queued sends without deleting messages', () => {
  const abort = new AbortController()
  const stop = vi.fn()
  const messages = [{ id: 'kept' }]
  const session = { chat: { stop, messages: [] }, status: 'streaming', isStreaming: true, data: { toolAbort: abort, tools: [{}], messages } } as unknown as ChatSession
  useChatSessions.setState({ sessions: { stuck: session }, requestActive: { stuck: true } })
  interruptWorkForEngineStop()
  expect(abort.signal.aborted).toBe(true)
  expect(stop).toHaveBeenCalledOnce()
  expect(useMessageQueue.getState().paused.stuck).toBe(true)
  expect(useChatSessions.getState().requestActive.stuck).toBe(false)
  expect(session.data.messages).toBe(messages)
  expect(session.data.tools).toEqual([])
})
