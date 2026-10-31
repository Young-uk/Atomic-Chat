import { expect, it } from 'vitest'
import { mergeRequestLedger, renderOpenRequests, requestSources } from './dstar-open-requests'
const sources = requestSources([
  { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Find the restaurant and report its name.' }] },
  { id: 'a', role: 'assistant', parts: [{ type: 'reasoning', text: 'private completion claim' }, { type: 'text', text: 'The verified restaurant is Maple.' }] },
])
it('preserves omitted commitments independently from shortened prose and keeps exact source text', () => {
  const first = mergeRequestLedger({ open: [], resolved: [] }, { summary: 'Brief memory', openRequests: [{ id: 'u', request: 'Find restaurant' }], resolvedRequests: [] }, sources)
  expect(first.ledger.open[0].sourceText).toBe('Find the restaurant and report its name.')
  const next = mergeRequestLedger(first.ledger, { summary: 'Shorter', openRequests: [], resolvedRequests: [] }, sources)
  expect(next.ledger).toEqual(first.ledger)
  expect(renderOpenRequests(next.ledger)).toContain('Find restaurant')
})
it('requires a real visible evidence quote to resolve a source-backed request', () => {
  const ledger = { open: [{ id: 'u', request: 'Find restaurant', sourceText: 'original' }], resolved: [] }
  expect(mergeRequestLedger(ledger, { summary: 'Memory', openRequests: [], resolvedRequests: [{ id: 'u', evidenceId: 'a', quote: 'private completion claim' }] }, sources).ledger).toEqual(ledger)
  const next = mergeRequestLedger(ledger, { summary: 'Memory', openRequests: [], resolvedRequests: [{ id: 'u', evidenceId: 'a', quote: 'The verified restaurant is Maple.' }] }, sources)
  expect(next.ledger.open).toEqual([])
  expect(next.ledger.resolved[0].evidenceId).toBe('a')
  expect(mergeRequestLedger(next.ledger, { summary: 'Memory', openRequests: [], resolvedRequests: next.ledger.resolved }, sources).ledger).toEqual(next.ledger)
})
it('rejects invented source IDs and incomplete model output instead of losing the old ledger', () => {
  expect(() => mergeRequestLedger({ open: [], resolved: [] }, { summary: 'Memory', openRequests: [{ id: 'invented', request: 'invented' }], resolvedRequests: [] }, sources)).toThrow('valid user-message source')
  expect(() => mergeRequestLedger({ open: [], resolved: [] }, { summary: 'Memory' }, sources)).toThrow('incomplete')
})

it('rejects unsupported resolutions independently while preserving valid completions and new commitments', () => {
  const original = { open: [{ id: 'u', request: 'Find restaurant', sourceText: 'original' }], resolved: [] }
  const prior = structuredClone(original)
  const result = mergeRequestLedger(original, { summary: 'Verified handoff',
    openRequests: [], resolvedRequests: [null, { id: 'u', evidenceId: 'missing', quote: 'invented' },
      { id: 'unknown', evidenceId: 'a', quote: 'The verified restaurant is Maple.' },
      { id: 'u', evidenceId: 'a', quote: 'The verified restaurant is Maple.' }] }, sources)
  expect(result.summary).toBe('Verified handoff')
  expect(result.ledger.open).toEqual([])
  expect(result.ledger.resolved).toEqual([{ id: 'u', evidenceId: 'a', quote: 'The verified restaurant is Maple.' }])
  expect(original).toEqual(prior)
})
it('keeps a newly discovered request open when the same response claims unsupported completion', () => {
  const result = mergeRequestLedger({ open: [], resolved: [] }, { summary: 'Still pending',
    openRequests: [{ id: 'u', request: 'Find restaurant' }],
    resolvedRequests: [{ id: 'u', evidenceId: 'a', quote: 'a paraphrase is not an exact quote' }] }, sources)
  expect(result.ledger.open[0].id).toBe('u')
  expect(result.ledger.resolved).toEqual([])
})

it('rejects an assistant message used as a new user-request source without mutating prior work', () => {
  const ledger = { open: [{ id: 'u', request: 'Verify restaurant', sourceText: 'original' }], resolved: [] }
  const before = structuredClone(ledger)
  expect(() => mergeRequestLedger(ledger, { summary: 'Memory', openRequests: [{ id: 'a', request: 'Mistaken assistant request' }], resolvedRequests: [] }, sources)).toThrow('valid user-message source')
  expect(ledger).toEqual(before)
})
