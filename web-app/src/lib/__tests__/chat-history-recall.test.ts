import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { CHAT_HISTORY_METADATA, chatHistoryLookupPlan, captureChatHistorySnapshot, withChatHistorySnapshots, matchesChatHistorySnapshot } from '../chat-history-recall'
const user = (text: string): UIMessage => ({ id: 'u1', role: 'user', parts: [{ type: 'text', text }] })
const question = '어? 어제 내가 다른 방에서 옷 얘기한 것 같은데?'
const evidence = { hits: [{ threadId: 'old', messageId: 'm1' }], context: { threadId: 'old', messages: [{ id: 'm1', text: 'thin coat' }, { id: 'm2', text: 'actually thick coat' }] } }
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())
it('routes explicit conversational recall, without ordinary questions, profile recall or refusal', () => {
  expect(chatHistoryLookupPlan([user(question)])).toMatchObject({ day: 'yesterday', withContext: true, limit: 3 })
  expect(chatHistoryLookupPlan([user('What did I say in the other chat yesterday?')])?.day).toBe('yesterday')
  for (const text of ['어제 날씨 어땠어?', '내 이름 기억나?', '어제 대화는 검색하지 마', 'Do not search the previous chat']) expect(chatHistoryLookupPlan([user(text)])).toBeUndefined()
})
it('persists real neighboring evidence once and replays identical model input without changing visible text', async () => {
  const messages = [user(question)]
  const captured = await captureChatHistorySnapshot(messages, async () => true, async () => evidence)
  const durable = [{ id: 'u1', metadata: { [CHAT_HISTORY_METADATA]: captured } }]
  const first = await withChatHistorySnapshots(messages, durable)
  const second = await withChatHistorySnapshots(messages, JSON.parse(JSON.stringify(durable)))
  expect(first).toEqual(second)
  expect(first[0].parts[0]).toMatchObject({ text: expect.stringContaining('actually thick coat') })
  expect(messages[0].parts).toEqual([{ type: 'text', text: question }])
  expect(await matchesChatHistorySnapshot(captured, user('edited question'))).toBe(false)
  expect(await withChatHistorySnapshots([user('edited question')], durable)).toEqual([user('edited question')])
})
it('never reads on denied or cancelled authorization and rejects incomplete evidence', async () => {
  let reads = 0
  const lookup = async () => { reads++; return evidence }
  await expect(captureChatHistorySnapshot([user(question)], async () => false, lookup)).rejects.toThrow('not authorized')
  const abort = new AbortController()
  await expect(captureChatHistorySnapshot([user(question)], async () => { abort.abort(); return true }, lookup, abort.signal)).rejects.toThrow()
  expect(reads).toBe(0)
  await expect(captureChatHistorySnapshot([user(question)], async () => true, async () => ({ hits: [{}] }))).rejects.toThrow('verified context')
  const empty = await captureChatHistorySnapshot([user(question)], async () => true, async () => ({ hits: [] }))
  expect(JSON.parse(empty!.evidence)).toEqual({ hits: [] })
})
it('discards a read that finishes after cancellation and excludes private reasoning from queries', async () => {
  const abort = new AbortController()
  await expect(captureChatHistorySnapshot([user(question)], async () => true, async () => { abort.abort(); return evidence }, abort.signal)).rejects.toThrow()
  const prior: UIMessage = { id: 'a', role: 'assistant', parts: [{ type: 'reasoning', text: 'PRIVATE CANARY' }, { type: 'text', text: 'weather jacket' }] }
  expect(chatHistoryLookupPlan([prior, user(question)])?.query).toContain('weather jacket')
  expect(chatHistoryLookupPlan([prior, user(question)])?.query).not.toContain('PRIVATE')
})
