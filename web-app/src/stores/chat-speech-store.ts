import { create } from 'zustand'
import type { Chat, UIMessage } from '@ai-sdk/react'
import { useChatSessions } from './chat-session-store'
import { createChatSpeechCursor } from '@/lib/audio/chat-speech-cursor'
import { createSpeechQueue } from '@/lib/audio/chat-speech-queue'

type SpeechQueue = ReturnType<typeof createSpeechQueue>
type SpeechState = {
  enabled: boolean
  status: 'idle' | 'ready' | 'speaking'
  setEnabled: (enabled: boolean) => void
  toggle: () => void
}

// A single app-owned FIFO prevents overlapping speakers across conversations.
// React components only observe it; navigation does not own or cancel it.
export const useChatSpeechStore = create<SpeechState>((set, get) => {
  let epoch = 0
  let ready = false
  let speaking = false
  let queue: Promise<SpeechQueue | null> = Promise.resolve(null)
  let draining: Promise<unknown> = Promise.resolve()
  let unsubscribeSessions: (() => void) | undefined
  const bindings = new Map<string, { chat: Chat<UIMessage>; dispose: () => void }>()
  const cursors = new WeakMap<Chat<UIMessage>, ReturnType<typeof createChatSpeechCursor>>()

  function publish(generation: number) {
    if (generation !== epoch || !get().enabled) return
    set({ status: speaking ? 'speaking' : ready ? 'ready' : 'idle' })
  }

  function startQueue(generation: number) {
    if (generation !== epoch || !get().enabled) return Promise.resolve(null)
    return draining.then(() => {
      if (generation !== epoch || !get().enabled) return null
      const speech = createSpeechQueue(
        (value) => { if (generation === epoch) { ready = value; publish(generation) } },
        (value) => { if (generation === epoch) { speaking = value; publish(generation) } }
      )
      void speech.prepare().catch(() => {})
      return speech
    })
  }

  function attachSessions(generation: number) {
    const sync = () => {
      const sessions = useChatSessions.getState().sessions
      for (const [id, binding] of bindings) {
        if (sessions[id]?.chat !== binding.chat) {
          binding.dispose()
          bindings.delete(id)
        }
      }
      for (const [id, { chat }] of Object.entries(sessions)) {
        if (bindings.has(id)) continue
        const read = cursors.get(chat) ?? createChatSpeechCursor()
        cursors.set(chat, read)
        // Re-enabling does not read a reply which finished while switched off.
        if (chat.status !== 'streaming' && chat.status !== 'submitted') {
          read(chat.messages, chat.status)
        }
        const consume = () => {
          if (generation !== epoch || !get().enabled) return
          const { sentences, newTurn } = read(chat.messages, chat.status)
          if (!sentences.length && !newTurn) return
          // Serialize recovery and enqueue operations as well as audio jobs.
          // A failed turn is not replayed. A later user turn can retry once
          // the old generation and transient clips have been cleaned up.
          queue = queue.then(async (speech) => {
            if (generation !== epoch || !get().enabled) return speech
            if (speech?.stopped && newTurn) {
              await speech.stop()
              if (generation !== epoch || !get().enabled) return speech
              speech = await startQueue(generation)
            }
            if (generation === epoch && get().enabled && speech && !speech.stopped) {
              speech.enqueue(sentences)
            }
            return speech
          })
        }
        const unsubscribeMessages = chat['~registerMessagesCallback'](consume)
        const unsubscribeStatus = chat['~registerStatusCallback'](consume)
        bindings.set(id, { chat, dispose: () => { unsubscribeMessages(); unsubscribeStatus() } })
        consume()
      }
    }
    unsubscribeSessions = useChatSessions.subscribe(sync)
    sync()
  }

  const shutdown = () => get().setEnabled(false)

  return {
    enabled: false,
    status: 'idle',
    toggle: () => get().setEnabled(!get().enabled),
    setEnabled(enabled) {
      if (enabled === get().enabled) return
      const generation = ++epoch
      ready = speaking = false
      set({ enabled, status: 'idle' })
      if (enabled) {
        queue = startQueue(generation)
        attachSessions(generation)
        window.addEventListener('pagehide', shutdown)
      } else {
        unsubscribeSessions?.()
        unsubscribeSessions = undefined
        for (const binding of bindings.values()) binding.dispose()
        bindings.clear()
        window.removeEventListener('pagehide', shutdown)
        const previous = queue
        draining = previous.then((speech) => speech?.stop())
        queue = Promise.resolve(null)
      }
    },
  }
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => useChatSpeechStore.getState().setEnabled(false))
}
