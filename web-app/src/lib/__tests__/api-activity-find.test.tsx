import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiActivityFindMatches, registerApiActivityFind, useApiActivityFind } from '../api-activity-find'
import type { ApiLogEntry } from '@/types/apiServerLog'

const entry = (id: string, model = id): ApiLogEntry => ({
  kind: 'request', id, model, seq: 1, startedAt: 0, status: 'completed',
  method: 'POST', endpoint: 'chat/completions', stream: false,
})
const roots: HTMLElement[] = []
function root() {
  const element = document.createElement('div')
  document.body.append(element)
  roots.push(element)
  return element
}
afterEach(() => {
  cleanup()
  roots.splice(0).forEach(element => element.remove())
})

describe('API activity find', () => {
  it('finds loaded rows outside the DOM window and reveals the right virtual index', () => {
    const element = root()
    element.textContent = 'Only the first row is mounted'
    const rows = Array.from({ length: 100 }, (_, i) => entry(String(i), `Model ${i}`))
    const reveal = vi.fn()
    const dispose = registerApiActivityFind(element, rows, reveal)
    const matches = apiActivityFindMatches(element, 'Model 99')!
    expect(matches).toHaveLength(1)
    matches[0].reveal()
    expect(reveal).toHaveBeenCalledWith(99)
    dispose()
  })
  it('matches literal case-insensitive text, not a regular expression', () => {
    const element = root()
    const dispose = registerApiActivityFind(element, [entry('1', 'A[b].* A[B].*')], vi.fn())
    const matches = apiActivityFindMatches(element, 'a[b].*')!
    expect(matches.map(({ start, end }) => [start, end])).toEqual([[0, 6], [7, 13]])
    expect(apiActivityFindMatches(element, '')).toEqual([])
    dispose()
  })
  it('resolves stale results against current filtered ordering and ignores removed rows', () => {
    const element = root()
    const reveal = vi.fn()
    const first = registerApiActivityFind(element, [entry('a'), entry('b')], reveal)
    const a = apiActivityFindMatches(element, 'a')!.find(match => match.text === 'a')!
    const b = apiActivityFindMatches(element, 'b')!.find(match => match.text === 'b')!
    const second = registerApiActivityFind(element, [entry('b')], reveal)
    first()
    b.reveal()
    expect(reveal).toHaveBeenCalledExactlyOnceWith(0)
    a.reveal()
    expect(reveal).toHaveBeenCalledTimes(1)
    second()
    b.reveal()
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(apiActivityFindMatches(element, 'b')).toBeNull()
    expect(element.hasAttribute('data-atomic-find-api-activity')).toBe(false)
  })
  it('does not search hidden metadata or replaced prompt previews', () => {
    const element = root()
    const row = { ...entry('private-id', 'Visible model'), promptPreview: 'hidden prompt', replyPreview: 'Visible reply', errorKind: 'private error' }
    const dispose = registerApiActivityFind(element, [row], vi.fn())
    expect(apiActivityFindMatches(element, 'private')).toEqual([])
    expect(apiActivityFindMatches(element, 'hidden')).toEqual([])
    expect(apiActivityFindMatches(element, 'Visible reply')).toHaveLength(1)
    dispose()
  })
  it('respects dialog scope and ignores detached roots', () => {
    const element = root()
    const dialog = root()
    const reveal = vi.fn()
    const dispose = registerApiActivityFind(element, [entry('row', 'Needle')], reveal)
    expect(apiActivityFindMatches(dialog, 'Needle')).toBeNull()
    const match = apiActivityFindMatches(element, 'Needle')![0]
    element.remove()
    match.reveal()
    expect(reveal).not.toHaveBeenCalled()
    dispose()
  })
  it('cleans up on unmount and lets the DOM finder search empty labels', () => {
    const reveal = vi.fn()
    function Harness({ rows }: { rows: ApiLogEntry[] }) {
      const ref = useRef<HTMLDivElement>(null)
      useApiActivityFind(ref, rows, reveal)
      return <div ref={ref}>Empty activity</div>
    }
    const mounted = render(<Harness rows={[entry('row', 'Needle')]} />)
    const element = mounted.container.firstElementChild as HTMLElement
    const match = apiActivityFindMatches(element, 'Needle')![0]
    mounted.rerender(<Harness rows={[]} />)
    expect(apiActivityFindMatches(element, 'Empty')).toBeNull()
    mounted.unmount()
    match.reveal()
    expect(reveal).not.toHaveBeenCalled()
  })
})


it('reveals, expands and targets the exact virtualized field occurrence, then cleans up', () => {
  const element = root()
  const reveal = vi.fn(() => {
    element.innerHTML = '<div data-atomic-find-api-row="row"><p data-atomic-find-api-field="5">needle first needle last</p></div>'
  })
  const dispose = registerApiActivityFind(element, [{ ...entry('row'), replyPreview: 'needle first needle last' }], reveal)
  const matches = apiActivityFindMatches(element, 'needle')!
  const cancel = matches[1].reveal()
  const target = matches[1].target?.() as Range
  expect(target.toString()).toBe('needle')
  expect(target.startOffset).toBe(13)
  expect(element.querySelector('[data-atomic-find-expanded]')).not.toBeNull()
  cancel?.()
  expect(element.querySelector('[data-atomic-find-expanded]')).toBeNull()
  dispose()
})
