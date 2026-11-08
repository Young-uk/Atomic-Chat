import { afterEach, expect, it, vi } from 'vitest'
import { clearFindHighlight, domFindMatches, findScope, occurrences, paintFindHighlights } from '../scoped-find'
afterEach(() => { clearFindHighlight(); document.body.innerHTML = ''; vi.unstubAllGlobals() })
it('finds literal text across inline markdown, excluding secrets and hidden content', () => {
  document.body.innerHTML = '<main><p>hello <strong>world</strong></p><input type="password" value="hello world"><input type="hidden" value="hello world"><p hidden>hello world</p><div aria-hidden="true">hello world</div><textarea>hello world</textarea></main>'
  const results = domFindMatches(document.querySelector('main')!, 'hello world')
  expect(results).toHaveLength(2)
  results[0].reveal()
  expect(window.getSelection()?.toString()).not.toBe('hello world')
})
it('uses exact UTF-16 offsets and treats regex syntax literally', () => {
  expect(occurrences('İ 😀 [x] [X]', '[x]')).toEqual([{ start: 5, end: 8 }, { start: 9, end: 12 }])
  expect(occurrences('aaa', '')).toEqual([])
})
it('prefers the focused multiline editor, then the open layer over background', () => {
  document.body.innerHTML = '<main>background</main><div role="dialog"><textarea>prompt</textarea><button>Save</button></div>'
  const editor = document.querySelector('textarea')!
  expect(findScope(editor)).toBe(editor)
  expect(findScope(document.querySelector('button'))).toBe(document.querySelector('[role="dialog"]'))
})

it('keeps persistent sidebar and navigation focus scoped to their own labels', () => {
  document.body.innerHTML = '<nav><button>Settings</button></nav><aside data-sidebar="sidebar"><button>Old chat</button></aside><main>Conversation</main>'
  expect(findScope(document.querySelector('nav button'))).toBe(document.querySelector('nav'))
  expect(findScope(document.querySelector('aside button'))).toBe(document.querySelector('aside'))
})

it('scopes inline message editors but keeps the ordinary composer in conversation search', () => {
  document.body.innerHTML = '<div data-atomic-find-conversation><div data-atomic-find-message="a"><textarea aria-label="Inline edit">edited</textarea></div><textarea aria-label="Composer">draft</textarea></div>'
  const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="Inline edit"]')!
  const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="Composer"]')!
  expect(findScope(editor)).toBe(editor)
  expect(findScope(composer)).toBe(document.querySelector('[data-atomic-find-conversation]'))
})

it('restores only the previously focused Find control after native reveal focus changes', async () => {
  const { preserveFindFocus } = await import('../scoped-find')
  document.body.innerHTML = '<div data-atomic-find-bar><input value="Language"></div><textarea>source</textarea><button>Other</button>'
  const input = document.querySelector('input')!
  const editor = document.querySelector('textarea')!
  input.focus(); input.setSelectionRange(2, 5)
  preserveFindFocus(() => editor.focus())
  expect(input).toHaveFocus()
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5])
  const other = document.querySelector('button')!
  other.focus()
  preserveFindFocus(() => domFindMatches(editor, 'source')[0].reveal())
  expect(other).toHaveFocus()
  expect(editor.value).toBe('source')
})


it('uses Custom Highlight without replacing existing user selection and cleans only its own highlight', async () => {
  const { clearFindHighlight } = await import('../scoped-find')
  const highlights = new Map<string, { ranges: Range[] }>()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class { constructor(...publicRanges: Range[]) { this.ranges = publicRanges } ranges: Range[] })
  document.body.innerHTML = '<p id="selected">selected</p><main><p>Language</p></main>'
  const selection = window.getSelection()!
  const range = document.createRange()
  range.selectNodeContents(document.getElementById('selected')!)
  selection.removeAllRanges(); selection.addRange(range)
  domFindMatches(document.querySelector('main')!, 'Language')[0].reveal()
  expect(highlights.get('atomic-find-current')?.ranges[0].toString()).toBe('Language')
  expect(selection.toString()).toBe('selected')
  clearFindHighlight()
  expect(highlights.has('atomic-find-current')).toBe(false)
  expect(selection.toString()).toBe('selected')
})


it('paints current and other exact occurrences and removes both on close', () => {
  const highlights = new Map<string, { ranges: Range[] }>()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class { constructor(...ranges: Range[]) { this.ranges = ranges } ranges: Range[] })
  document.body.innerHTML = '<main><p>needle one needle two</p></main>'
  const matches = domFindMatches(document.querySelector('main')!, 'needle')
  paintFindHighlights(matches, 1)
  expect(highlights.get('atomic-find-current')?.ranges[0].startOffset).toBe(11)
  expect(highlights.get('atomic-find-other')?.ranges[0].startOffset).toBe(0)
  clearFindHighlight()
  expect(highlights.size).toBe(0)
  expect(document.querySelector('[data-atomic-find-overlay]')).toBeNull()
  expect(document.querySelector('p')?.textContent).toBe('needle one needle two')
})

it('uses a non-interactive colored fallback without inserting marks into React text', () => {
  vi.stubGlobal('Highlight', undefined)
  const old = Range.prototype.getClientRects
  Range.prototype.getClientRects = () => [new DOMRect(20, 30, 50, 18)] as unknown as DOMRectList
  try {
    document.body.innerHTML = '<main><p>needle needle</p></main>'
    const matches = domFindMatches(document.querySelector('main')!, 'needle')
    paintFindHighlights(matches, 0)
    expect(document.querySelector('[data-atomic-find-rect="current"]')).not.toBeNull()
    expect(document.querySelector('[data-atomic-find-rect="other"]')).not.toBeNull()
    expect(document.querySelector('[data-atomic-find-overlay]')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('main mark')).toBeNull()
    clearFindHighlight()
    expect(document.querySelector('[data-atomic-find-overlay]')).toBeNull()
  } finally { Range.prototype.getClientRects = old }
})
