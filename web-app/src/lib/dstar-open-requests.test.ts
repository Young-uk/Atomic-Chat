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
  expect(() => mergeRequestLedger(ledger, { summary: 'Memory', openRequests: [], resolvedRequests: [{ id: 'u', evidenceId: 'a', quote: 'private completion claim' }] }, sources)).toThrow('visible completion evidence')
  const next = mergeRequestLedger(ledger, { summary: 'Memory', openRequests: [], resolvedRequests: [{ id: 'u', evidenceId: 'a', quote: 'The verified restaurant is Maple.' }] }, sources)
  expect(next.ledger.open).toEqual([])
  expect(next.ledger.resolved[0].evidenceId).toBe('a')
  expect(mergeRequestLedger(next.ledger, { summary: 'Memory', openRequests: [], resolvedRequests: next.ledger.resolved }, sources).ledger).toEqual(next.ledger)
})
it('rejects invented source IDs and incomplete model output instead of losing the old ledger', () => {
  expect(() => mergeRequestLedger({ open: [], resolved: [] }, { summary: 'Memory', openRequests: [{ id: 'invented', request: 'invented' }], resolvedRequests: [] }, sources)).toThrow('valid user-message source')
  expect(() => mergeRequestLedger({ open: [], resolved: [] }, { summary: 'Memory' }, sources)).toThrow('incomplete')
})
