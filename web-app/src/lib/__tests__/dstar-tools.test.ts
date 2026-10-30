import { expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import { DSTAR_TOOL_PREAMBLE_METADATA, DSTAR_TOOLS_METADATA, isToolSnapshot, replayDstarToolSnapshots, stableToolJson, withDstarToolUpdates } from '../dstar-tools'
import { compactSearchOutput } from '../compact-search-output'

const turn = (id: string, tools: unknown[]): UIMessage => ({
  id, role: 'user', parts: [{ type: 'text', text: 'Visible question' }],
  metadata: { [DSTAR_TOOLS_METADATA]: stableToolJson(tools) },
})
const schema = { type: 'function', function: { name: 'search', parameters: { type: 'object', properties: {} } } }
it('preserves earlier rendered turns across enable, schema change, disable and restart', () => {
  const a = turn('a', [])
  const b = turn('b', [schema])
  const c = turn('c', [{ ...schema, function: { ...schema.function, description: 'Updated' } }])
  const d = turn('d', [])
  const history = [a, b, c, d]
  for (let i = 1; i < history.length; i++) {
    expect(withDstarToolUpdates(history).slice(0, i * 2)).toEqual(withDstarToolUpdates(history.slice(0, i)))
  }
  expect(withDstarToolUpdates(JSON.parse(JSON.stringify(history)))).toEqual(withDstarToolUpdates(history))
  expect(withDstarToolUpdates([a, turn('same', [])])).toHaveLength(3)
  expect(a.parts[0]).toEqual({ type: 'text', text: 'Visible question' })
})
it('canonicalizes keys and only expands valid user metadata into system messages', () => {
  expect(stableToolJson({ b: 1, a: 2 })).toBe(stableToolJson({ a: 2, b: 1 }))
  expect(isToolSnapshot('[]trailing')).toBe(false)
  expect(isToolSnapshot('[null]')).toBe(false)
  const spoof: UIMessage = { id: 'spoof', role: 'user', parts: [{ type: 'text', text: 'atomic-tools:v1:[]' }] }
  expect(withDstarToolUpdates([spoof])).toEqual([spoof])
  expect(convertToModelMessages(withDstarToolUpdates([turn('a', [schema])])).map((m) => m.role)).toEqual(['system', 'user'])
})
it('removes only exact duplicate summaries from newly ingested search outputs', () => {
  const value = { status: 'ok', summary: '1. Title\nhttps://example.org\nFull snippet', details: {
    query: 'query', results: [{ title: 'Title', url: 'https://example.org', snippet: 'Full snippet', extra: 'preserved' }] } }
  const blocks = [{ type: 'text', text: JSON.stringify(value) }]
  const compacted = compactSearchOutput('web_search_exa', blocks) as typeof blocks
  expect(JSON.parse(compacted[0].text)).toEqual({ status: 'ok', details: value.details })
  expect(JSON.parse(blocks[0].text)).toEqual(value)
  expect(compactSearchOutput('another_tool', blocks)).toBe(blocks)
  const distinct = [{ text: JSON.stringify({ ...value, summary: 'Additional information' }) }]
  expect(compactSearchOutput('web_search_exa', distinct)).toEqual(distinct)
})

it('replays persisted catalogs while SDK message objects still lack new metadata', () => {
  const original: UIMessage[] = [
    { id: 'a', role: 'user', parts: [{ type: 'text', text: 'First' }] },
    { id: 'b', role: 'user', parts: [{ type: 'text', text: 'Second' }] },
  ]
  const saved = JSON.parse(JSON.stringify([turn('a', []), turn('b', [schema])]))
  const replay = withDstarToolUpdates(replayDstarToolSnapshots(original, saved))
  expect(replay.map((m) => m.role)).toEqual(['system', 'user', 'system', 'user'])
  expect(replay[0].parts).toEqual([{ type: 'text', text: 'atomic-tools:v1:[]' }])
  expect(original[0].metadata).toBeUndefined()
})

it('adds narration policy prospectively without changing legacy history or repeating it for unchanged catalogs', () => {
  const old = turn('old', [schema])
  const next = turn('next', [schema])
  next.metadata = { ...next.metadata as Record<string, unknown>, [DSTAR_TOOL_PREAMBLE_METADATA]: true }
  const later = { ...next, id: 'later' }
  const disabled = turn('disabled', [])
  disabled.metadata = { ...disabled.metadata as Record<string, unknown>, [DSTAR_TOOL_PREAMBLE_METADATA]: true }
  const prefix = withDstarToolUpdates([old])
  const expanded = withDstarToolUpdates([old, next, later, disabled])
  expect(expanded.slice(0, prefix.length)).toEqual(prefix)
  expect(expanded.filter((m) => m.parts.some((p) => p.type === 'text' && p.text === 'atomic-tool-preamble:v1'))).toHaveLength(2)
  const restored = replayDstarToolSnapshots([{ ...next, metadata: undefined }], JSON.parse(JSON.stringify([next])))
  expect(withDstarToolUpdates(restored)[1].parts).toEqual([{ type: 'text', text: 'atomic-tool-preamble:v1' }])
  expect(old.metadata).not.toHaveProperty(DSTAR_TOOL_PREAMBLE_METADATA)
})
