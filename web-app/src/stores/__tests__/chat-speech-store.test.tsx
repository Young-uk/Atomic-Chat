import { act, renderHook } from '@testing-library/react'
import { Chat, type UIMessage } from '@ai-sdk/react'
import type { UIMessageChunk } from 'ai'
import type { CustomChatTransport } from '@/lib/custom-chat-transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notifications', () => ({ notifyUnlessWatching: vi.fn() }))
const makeQueue = vi.hoisted(() => vi.fn())
vi.mock('@/lib/audio/chat-speech-queue', () => ({ createSpeechQueue: makeQueue }))

import { useChatSpeechStore } from '@/stores/chat-speech-store'
import { useChatSessions } from '@/stores/chat-session-store'
import { useChatSpeech } from '@/hooks/useChatSpeech'

const queues: Array<{
  enqueue: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  stopped: boolean
  ready: (ready: boolean) => void
  speaking: (speaking: boolean) => void
}> = []
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const user = (id = 'user'): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text: 'Hello' }] })
const reply = (text: string, id = 'reply'): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] })

function session(id: string) {
  const messageListeners = new Set<() => void>()
  const statusListeners = new Set<() => void>()
  const chat = {
    messages: [] as UIMessage[], status: 'ready', stop: vi.fn(),
    '~registerMessagesCallback': (cb: () => void) => { messageListeners.add(cb); return () => messageListeners.delete(cb) },
    '~registerStatusCallback': (cb: () => void) => { statusListeners.add(cb); return () => statusListeners.delete(cb) },
  }
  useChatSessions.getState().ensureSession(id, {} as CustomChatTransport, () => chat as unknown as Chat<UIMessage>)
  return {
    chat,
    update(text: string, status = 'streaming', userId = 'user') {
      chat.messages = [user(userId), reply(text)]
      chat.status = status
      messageListeners.forEach((cb) => cb())
      statusListeners.forEach((cb) => cb())
    },
    listenerCount: () => messageListeners.size,
  }
}

beforeEach(async () => {
  useChatSpeechStore.getState().setEnabled(false)
  await flush()
  useChatSessions.getState().clearSessions()
  queues.length = 0
  makeQueue.mockReset().mockImplementation((ready, speaking) => {
    const queue = {
      enqueue: vi.fn(), prepare: vi.fn(async () => ready(true)),
      stop: vi.fn(async () => { queue.stopped = true }),
      stopped: false, ready, speaking,
    }
    queues.push(queue)
    return queue
  })
})
afterEach(async () => {
  useChatSpeechStore.getState().setEnabled(false)
  await flush()
})

describe('app-owned chat speech', () => {
  it('keeps the player and background stream after navigation and never repeats on return', async () => {
    const a = session('a')
    const b = session('b')
    const firstPage = renderHook(() => useChatSpeech())
    await act(async () => { firstPage.result.current.toggle(); await flush() })
    await act(async () => { a.update('First sentence. '); await flush() })
    firstPage.unmount()
    const nextPage = renderHook(() => useChatSpeech())
    expect(nextPage.result.current.enabled).toBe(true)
    await act(async () => {
      a.update('First sentence. Background tail', 'ready')
      b.update('Other chat.')
      queues[0].speaking(true)
      await flush()
    })
    expect(nextPage.result.current.status).toBe('speaking')
    nextPage.unmount()
    const returnedPage = renderHook(() => useChatSpeech())
    await act(async () => { a.update('First sentence. Background tail', 'ready'); await flush() })
    expect(makeQueue).toHaveBeenCalledTimes(1)
    expect(queues[0].stop).not.toHaveBeenCalled()
    expect(queues[0].enqueue.mock.calls.flatMap(([sentences]) => sentences.map((s: { text: string }) => s.text)))
      .toEqual(['First sentence.', 'Background tail', 'Other chat.'])
    await act(async () => { returnedPage.result.current.toggle(); await flush() })
    expect(queues[0].stop).toHaveBeenCalledTimes(1)
    expect(a.listenerCount()).toBe(0)
    expect(b.listenerCount()).toBe(0)
  })

  it('waits for a late cancellation before re-enabling and ignores stale status callbacks', async () => {
    const a = session('a')
    useChatSpeechStore.getState().setEnabled(true)
    await flush()
    a.update('Read once. ')
    await flush()
    let finish!: () => void
    queues[0].stop.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    useChatSpeechStore.getState().setEnabled(false)
    useChatSpeechStore.getState().setEnabled(true)
    await flush()
    expect(makeQueue).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    expect(makeQueue).toHaveBeenCalledTimes(2)
    queues[0].speaking(true)
    expect(useChatSpeechStore.getState().status).toBe('ready')
    a.update('Read once. New words.', 'ready')
    await flush()
    expect(queues[1].enqueue.mock.calls.flatMap(([sentences]) => sentences.map((s: { text: string }) => s.text)))
      .toEqual(['New words.'])
  })

  it('does not read loaded history or replay a failed turn; the next turn can recover', async () => {
    const a = session('a')
    a.update('Old reply.', 'ready')
    useChatSpeechStore.getState().setEnabled(true)
    await flush()
    expect(queues[0].enqueue).not.toHaveBeenCalled()
    a.update('Failed sentence.', 'streaming', 'new-user')
    await flush()
    queues[0].stopped = true
    a.update('Failed sentence. More text.', 'ready', 'new-user')
    await flush()
    expect(makeQueue).toHaveBeenCalledTimes(1)
    expect(useChatSpeechStore.getState().enabled).toBe(true)
    a.update('Next turn.', 'streaming', 'next-user')
    await flush()
    expect(makeQueue).toHaveBeenCalledTimes(2)
    expect(queues[1].enqueue).toHaveBeenCalledWith([{ text: 'Next turn.', instruct: undefined }])
  })

  it('does not deadlock when Off/On interrupts recovery of a failed queue', async () => {
    const a = session('a')
    useChatSpeechStore.getState().setEnabled(true)
    await flush()
    a.update('Failed turn.')
    await flush()
    queues[0].stopped = true
    let finish!: () => void
    const stopped = new Promise<void>((resolve) => { finish = resolve })
    queues[0].stop.mockReturnValue(stopped)
    a.update('Recovery turn.', 'streaming', 'recovery-user')
    await flush()
    useChatSpeechStore.getState().setEnabled(false)
    useChatSpeechStore.getState().setEnabled(true)
    finish()
    await flush()
    expect(makeQueue).toHaveBeenCalledTimes(2)
    expect(useChatSpeechStore.getState()).toMatchObject({ enabled: true, status: 'ready' })
    a.update('Fresh turn.', 'streaming', 'fresh-user')
    await flush()
    expect(queues[1].enqueue).toHaveBeenCalledWith([{ text: 'Fresh turn.', instruct: undefined }])
  })

  it('cleans up on application pagehide without treating route unmount as shutdown', async () => {
    const a = session('a')
    useChatSpeechStore.getState().setEnabled(true)
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    await flush()
    expect(useChatSpeechStore.getState().enabled).toBe(false)
    expect(queues[0].stop).toHaveBeenCalledTimes(1)
    expect(a.listenerCount()).toBe(0)
  })

  it('receives the real AI SDK Chat stream after its UI unmounts', async () => {
    let stream!: ReadableStreamDefaultController<UIMessageChunk>
    const transport = {
      sendMessages: async () => new ReadableStream<UIMessageChunk>({ start(controller) { stream = controller } }),
      reconnectToStream: async () => null,
    }
    const chat = new Chat({ transport })
    useChatSessions.getState().ensureSession('real', transport as unknown as CustomChatTransport, () => chat)
    const page = renderHook(() => useChatSpeech())
    await act(async () => { page.result.current.toggle(); await flush() })
    let sent!: Promise<void>
    await act(async () => { sent = chat.sendMessage({ text: 'Speak' }); await flush() })
    page.unmount()
    stream.enqueue({ type: 'start', messageId: 'real-reply' })
    stream.enqueue({ type: 'text-start', id: 'text' })
    stream.enqueue({ type: 'text-delta', id: 'text', delta: 'Still speaking. Tail' })
    stream.enqueue({ type: 'text-end', id: 'text' })
    stream.enqueue({ type: 'finish' })
    stream.close()
    await sent
    await flush()
    expect(queues[0].enqueue.mock.calls.flatMap(([sentences]) => sentences.map((s: { text: string }) => s.text)))
      .toEqual(['Still speaking.', 'Tail'])
    expect(queues[0].stop).not.toHaveBeenCalled()
  })
})
