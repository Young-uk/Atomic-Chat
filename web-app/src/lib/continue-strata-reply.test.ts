import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { STRATA_MODEL, STRATA_PROVIDER } from '@/services/managed-local-engine'
import { canContinueStrataReply, enqueueReplyContinuation } from './continue-strata-reply'

const metadata = { providerId: STRATA_PROVIDER, modelId: STRATA_MODEL, finishReason: 'stop' }
const reply: UIMessage = {
  id: 'reply',
  role: 'assistant',
  metadata,
  parts: [
    { type: 'dynamic-tool', toolCallId: '1', toolName: 'lookup', state: 'output-available', input: {}, output: 'saved result' },
    { type: 'text', text: '| 12/03 | 3.8 / 12' },
  ],
}
const eligible = (message: UIMessage) => canContinueStrataReply(message, STRATA_PROVIDER, STRATA_MODEL)

describe('manual Strata reply continuation', () => {
  it('accepts a visible table fragment or sentence independently of punctuation', () => {
    expect(eligible(reply)).toBe(true)
    for (const text of ['넘어갈 수', 'A finished sentence.']) {
      expect(eligible({ ...reply, parts: [{ type: 'text', text }] })).toBe(true)
    }
  })

  it('requires a finished reply from the selected Strata model', () => {
    expect(canContinueStrataReply(reply, 'other', STRATA_MODEL)).toBe(false)
    expect(canContinueStrataReply(reply, STRATA_PROVIDER, 'other')).toBe(false)
    for (const overrides of [
      { role: 'user' as const }, { metadata: undefined },
      { metadata: { ...metadata, providerId: 'other' } },
      { metadata: { ...metadata, modelId: 'other' } },
      { metadata: { ...metadata, finishReason: 'tool-calls' } },
      { metadata: { ...metadata, turn_error: { message: 'error' } } },
    ]) expect(eligible({ ...reply, ...overrides })).toBe(false)
    expect(eligible({ ...reply, metadata: { ...metadata, finishReason: 'length' } })).toBe(true)
    expect(eligible({ ...reply, parts: [{ type: 'reasoning', text: 'waiting' }, { type: 'text', text: ' ' }] })).toBe(false)
    expect(eligible({ ...reply, parts: [
      ...reply.parts,
      { type: 'dynamic-tool', toolName: 'lookup', state: 'input-available', toolCallId: '2', input: {} },
    ] })).toBe(false)
  })

  beforeEach(() => useMessageQueue.setState({ byThread: {}, inFlight: {}, paused: {} }))

  it('enqueues one visible text send with its own empty attachment snapshot', () => {
    enqueueReplyContinuation('test', '이어서 써 줘')
    enqueueReplyContinuation('test', '이어서 써 줘')
    const queue = useMessageQueue.getState()
    expect(queue.byThread.test).toHaveLength(1)
    expect(queue.claim('test')).toEqual({ id: expect.any(String), text: '이어서 써 줘', documents: [] })
    enqueueReplyContinuation('test', '이어서 써 줘')
    expect(useMessageQueue.getState().byThread.test).toEqual([])
    queue.release('test')
    queue.pause('test', true)
    enqueueReplyContinuation('test', '이어서 써 줘')
    expect(useMessageQueue.getState().byThread.test).toEqual([])
  })
})
