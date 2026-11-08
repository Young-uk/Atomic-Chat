import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { FindInPage } from './FindInPage'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { expectNoHorizontalOverflow, setFontSize, settle } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('13px') })
it.each([1024, 1280])('fits and finds the last wrapped editor line at %s px', async width => {
  await page.viewport(width, 800)
  for (const font of ['13px', '20px']) for (const dark of [false, true]) {
    setFontSize(font); document.documentElement.classList.toggle('dark', dark)
    render(<><Dialog defaultOpen><DialogContent><DialogTitle>Assistant editor</DialogTitle><textarea aria-label="System prompt" style={{ height: 160, width: '100%' }} defaultValue={'Long realistic wrapped prompt instructions '.repeat(400) + '\nneedle last line'} /></DialogContent></Dialog><FindInPage /></>)
    const editor = screen.getByLabelText('System prompt') as HTMLTextAreaElement
    editor.focus()
    fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
    fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
    await settle(screen.getByRole('dialog'))
    expectNoHorizontalOverflow(screen.getByRole('search'))
    expectNoHorizontalOverflow(screen.getByRole('dialog'))
    expect(screen.getByLabelText('Find text')).toHaveFocus()
    expect(editor.scrollTop).toBeGreaterThan(0)
    expect(editor.scrollHeight - editor.clientHeight - editor.scrollTop).toBeLessThan(60)
    expect(editor.selectionStart).toBe(editor.value.indexOf('needle'))
    expect(screen.getByRole('status')).toHaveTextContent('1/1')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(editor).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeVisible()
    cleanup()
  }
})

it('keeps Find visible when a long dialog scrolls to its final text', async () => {
  render(<><Dialog defaultOpen><DialogContent><DialogTitle>Long settings</DialogTitle><div style={{ height: 1600 }}>Settings content</div><p>final needle</p></DialogContent></Dialog><FindInPage /></>)
  fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
  fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
  await settle(screen.getByRole('dialog'))
  const bar = screen.getByRole('search').getBoundingClientRect()
  const dialog = screen.getByRole('dialog').getBoundingClientRect()
  expect(bar.top).toBeGreaterThanOrEqual(dialog.top)
  expect(bar.bottom).toBeLessThanOrEqual(dialog.bottom)
  expectNoHorizontalOverflow(screen.getByRole('search'))
})

it('wraps controls inside a narrow menu without clipping', async () => {
  render(<><div role="menu" style={{ position: 'relative', width: 140, maxHeight: 300, overflow: 'auto' }}><button role="menuitem">Downloads</button><div style={{ height: 600 }} /><button role="menuitem">Final settings</button></div><FindInPage /></>)
  screen.getByRole('menuitem', { name: 'Downloads' }).focus()
  fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
  fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'Final' } })
  await settle(screen.getByRole('menu'))
  expectNoHorizontalOverflow(screen.getByRole('search'))
  expectNoHorizontalOverflow(screen.getByRole('menu'))
  const bar = screen.getByRole('search').getBoundingClientRect()
  const menu = screen.getByRole('menu').getBoundingClientRect()
  expect(bar.top).toBeGreaterThanOrEqual(menu.top)
  expect(bar.bottom).toBeLessThanOrEqual(menu.bottom)
})


it.each([false, true])('retains query focus and caret for real typing, fallback=%s', async fallback => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
  if (fallback) Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: undefined })
  try {
    render(<><main><button>Other control</button><p>Language Language</p></main><FindInPage /></>)
    const other = screen.getByText('Other control')
    other.focus()
    fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
    await settle(screen.getByRole('search'))
    const input = screen.getByLabelText('Find text') as HTMLInputElement
    let value = ''
    for (const character of 'Language') {
      await userEvent.keyboard(character)
      value += character
      expect(input).toHaveValue(value)
      expect(input).toHaveFocus()
      expect(input.selectionStart).toBe(value.length)
      expect(input.selectionEnd).toBe(value.length)
      expect(window.getSelection()?.toString()).toBe('')
    }
    input.setSelectionRange(2, 5)
    await userEvent.keyboard('{Enter}')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(5)
    expect(screen.getByRole('status')).toHaveTextContent('2/2')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(5)
    expect(screen.getByRole('status')).toHaveTextContent('1/2')
    await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(5)
    expect(screen.getByRole('status')).toHaveTextContent('2/2')
    const highlights = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights
    if (!fallback && descriptor) expect(highlights?.has('atomic-find-current')).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('search')).toBeNull()
    expect(other).toHaveFocus()
    expect(highlights?.has('atomic-find-current') ?? false).toBe(false)
    expect(screen.getByText('Language Language')).toHaveTextContent('Language Language')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Highlight', descriptor)
    else Reflect.deleteProperty(globalThis, 'Highlight')
  }
})

it('types a full query while revealing textarea matches without editing the source', async () => {
  render(<><textarea aria-label="Prompt" defaultValue="Language Language" /><FindInPage /></>)
  const editor = screen.getByLabelText('Prompt') as HTMLTextAreaElement
  editor.focus()
  fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
  await settle(screen.getByRole('search'))
  const input = screen.getByLabelText('Find text') as HTMLInputElement
  let value = ''
  for (const character of 'Language') {
    await userEvent.keyboard(character)
    value += character
    expect(input).toHaveValue(value)
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(value.length)
    expect(editor.value).toBe('Language Language')
  }
  await userEvent.keyboard('{Enter}')
  expect(input).toHaveFocus()
  expect(editor.selectionStart).toBe(9)
  await userEvent.keyboard('{Escape}')
  expect(editor).toHaveFocus()
  expect(editor.value).toBe('Language Language')
})

it('lets Enter activate focused Previous and Close buttons', async () => {
  render(<><main><p>Language Language</p></main><FindInPage /></>)
  fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
  await settle(screen.getByRole('search'))
  await userEvent.keyboard('Language')
  screen.getByRole('button', { name: 'Previous match' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('2/2')
  expect(screen.getByLabelText('Find text')).toHaveFocus()
  screen.getByRole('button', { name: 'Close find' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.queryByRole('search')).toBeNull()
})

it.each([false, true])('scrolls to the exact line in one long paragraph, with visible highlight, fallback=%s', async fallback => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
  if (fallback) Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: undefined })
  try {
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle('dark', dark)
      render(<><main style={{ height: 260, overflow: 'auto', width: 480 }}><p data-testid="long-paragraph" style={{ whiteSpace: 'pre-wrap' }}>{'needle start\n' + 'A long line of ordinary text\n'.repeat(220) + 'needle end'}</p></main><FindInPage /></>)
      const main = document.querySelector('main')!
      fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
      fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
      await settle(main)
      const input = screen.getByLabelText('Find text')
      fireEvent.keyDown(input, { key: 'Enter' })
      await settle(main)
      const paragraph = screen.getByTestId('long-paragraph')
      const text = paragraph.firstChild!
      const range = document.createRange()
      range.setStart(text, text.textContent!.lastIndexOf('needle'))
      range.setEnd(text, text.textContent!.lastIndexOf('needle') + 6)
      const rect = range.getBoundingClientRect(), viewport = main.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(viewport.top)
      expect(rect.bottom).toBeLessThanOrEqual(viewport.bottom)
      expect(input).toHaveFocus()
      expect(screen.getByRole('status')).toHaveTextContent('2/2')
      if (fallback) {
        const mark = document.querySelector<HTMLElement>('[data-atomic-find-rect="current"]')!
        expect(mark).not.toBeNull()
        expect(Math.abs(mark.getBoundingClientRect().top - rect.top)).toBeLessThan(2)
      } else {
        const registry = (CSS as typeof CSS & { highlights: Map<string, Set<Range>> }).highlights
        expect([...registry.get('atomic-find-current')!][0].startOffset).toBe(range.startOffset)
        expect(registry.get('atomic-find-other')?.size).toBe(1)
      }
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
      await settle(main)
      expect(main.scrollTop).toBeLessThan(40)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(document.querySelector('[data-atomic-find-overlay]')).toBeNull()
      expect(paragraph.textContent).toBe('needle start\n' + 'A long line of ordinary text\n'.repeat(220) + 'needle end')
      cleanup()
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Highlight', descriptor)
    else Reflect.deleteProperty(globalThis, 'Highlight')
  }
})

it('keeps an editor occurrence visibly colored while the Find input owns focus', async () => {
  render(<><textarea aria-label="Long editor" style={{ width: 400, height: 160 }} defaultValue={'Wrapped source text '.repeat(300) + ' needle END'} /><FindInPage /></>)
  const editor = screen.getByLabelText('Long editor') as HTMLTextAreaElement
  const original = editor.value
  editor.focus()
  fireEvent.keyDown(window, { key: 'f', metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) })
  fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
  await settle(editor)
  const mark = document.querySelector<HTMLElement>('[data-atomic-find-rect="current"]')!
  expect(mark).not.toBeNull()
  const box = mark.getBoundingClientRect(), viewport = editor.getBoundingClientRect()
  expect(box.top).toBeGreaterThanOrEqual(viewport.top)
  expect(box.bottom).toBeLessThanOrEqual(viewport.bottom)
  expect(screen.getByLabelText('Find text')).toHaveFocus()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(editor).toHaveValue(original)
  expect(editor).toHaveFocus()
  expect(document.querySelector('[data-atomic-find-overlay]')).toBeNull()
})
