import { expect, it } from 'vitest'
import { SummaryAdmission, summarySchedulingContext } from '../atomic-summary-admission'

it('uses actual foreground context for scheduling independently of native admission bounds', () => {
  expect(summarySchedulingContext(65536)).toBe(65536)
  expect(summarySchedulingContext(32768)).toBe(32768)
  const admission = new SummaryAdmission(8192)
  admission.observeForeground(48002, 'completed')
  admission.refuse()
  expect(admission.allowed).toBe(false)
  expect(summarySchedulingContext(65536)).toBe(65536)
})
it('suppresses repeated refusals until a measured smaller safe-headroom state or a new runtime', () => {
  const policy = new SummaryAdmission(8192)
  policy.observeForeground(9000, 'initial'); policy.refuse()
  expect(() => policy.assertAllowed()).toThrow('deferred')
  for (const tokens of [9000, 12000, 5000, NaN]) {
    policy.observeForeground(tokens, `completion-${tokens}`)
    expect(policy.allowed).toBe(false)
  }
  policy.observeForeground(3000, 'smaller')
  expect(policy.allowed).toBe(true)
  policy.refuse(); policy.observeForeground(3000, 'smaller')
  expect(policy.allowed).toBe(false)
  expect(new SummaryAdmission(8192).allowed).toBe(true)
})
it('rearms unknown refusal once after a new successful measured completion, never by repeated callback', () => {
  const policy = new SummaryAdmission(8192)
  policy.refuse()
  expect(policy.allowed).toBe(false)
  policy.observeForeground(NaN, 'missing')
  policy.observeForeground(1, 'missing') // Same callback cannot replace missing evidence.
  expect(policy.allowed).toBe(false)
  policy.observeForeground(5000, 'too-large')
  expect(policy.allowed).toBe(false)
  policy.observeForeground(3000, 'first-small')
  expect(policy.allowed).toBe(true)
  policy.refuse()
  policy.observeForeground(1000, 'first-small') // Duplicate completion, even with changed count.
  policy.observeForeground(3000, 'second-same-count')
  expect(policy.allowed).toBe(false)
  policy.observeForeground(2000, 'third-smaller')
  expect(policy.allowed).toBe(true)
})
