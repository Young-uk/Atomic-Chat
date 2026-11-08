import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { createChatSpeechCursor } from '../chat-speech-cursor'

const messages = (text: string, id = 'reply'): UIMessage[] => [
  { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
  { id, role: 'assistant', parts: [{ type: 'text', text }] },
]

describe('chat speech stream cursor', () => {
  it('keeps partial style markers and flushes the unfinished tail once', () => {
    const read = createChatSpeechCursor()
    expect(read(messages('Hello. [[voi'), 'streaming').sentences).toEqual([{ text: 'Hello.', instruct: undefined }])
    expect(read(messages('Hello. [[voice:calm]]This is'), 'streaming').sentences).toEqual([])
    expect(read(messages('Hello. [[voice:calm]]This is the rest'), 'ready').sentences).toEqual([{ text: 'This is the rest', instruct: 'calm' }])
    expect(read(messages('Hello. [[voice:calm]]This is the rest'), 'ready').sentences).toEqual([])
  })

  it('retains message offsets across tool steps and does not replay edited prefixes', () => {
    const read = createChatSpeechCursor()
    expect(read(messages('First.'), 'streaming').sentences).toHaveLength(1)
    expect(read(messages('Second.', 'tool-followup'), 'streaming').sentences).toHaveLength(1)
    expect(read(messages('First.'), 'ready').sentences).toEqual([])
    expect(read(messages('Changed first.'), 'streaming').sentences).toEqual([])
  })

  it('never treats history as a newly submitted turn', () => {
    const read = createChatSpeechCursor()
    expect(read(messages('Old reply.'), 'ready').sentences).toEqual([])
    expect(read(messages('New reply.'), 'submitted').sentences).toEqual([])
    expect(read(messages('New reply.'), 'streaming').sentences).toEqual([{ text: 'New reply.', instruct: undefined }])
  })
})
