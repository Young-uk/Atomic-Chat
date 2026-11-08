import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FindInPage } from './FindInPage'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

function open() { fireEvent.keyDown(window, { key: 'f', ctrlKey: true }) }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('FindInPage', () => {
  it('searches current textarea value, navigates, restores focus and never changes it', async () => {
    render(<><textarea aria-label="Prompt" defaultValue={'needle\n' + 'many lines\n'.repeat(90) + 'NEEDLE'} /><FindInPage /></>)
    const editor = screen.getByLabelText('Prompt') as HTMLTextAreaElement
    const value = editor.value
    editor.focus(); open()
    fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1/2'))
    fireEvent.keyDown(screen.getByLabelText('Find text'), { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('2/2')
    expect(editor.selectionStart).toBe(value.length - 6)
    fireEvent.keyDown(screen.getByLabelText('Find text'), { key: 'Enter', shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('1/2')
    fireEvent.keyDown(window, { key: 'g', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('2/2')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(editor).toHaveFocus(); expect(editor.value).toBe(value)
  })
  it('keeps Find inside modal and Escape does not dismiss the dialog', async () => {
    const changed = vi.fn()
    render(<><p>outside needle</p><Dialog defaultOpen onOpenChange={changed}><DialogContent><DialogTitle>Assistant</DialogTitle><p>inside needle</p></DialogContent></Dialog><FindInPage /></>)
    open()
    fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
    await waitFor(() => expect(screen.getByLabelText('Find text')).toHaveFocus())
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('search'))
    expect(screen.getByRole('status')).toHaveTextContent('1/1')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(changed).not.toHaveBeenCalled()
  })
  it('searches menu labels without activating menu items or typeahead', async () => {
    const selected = vi.fn()
    render(<><DropdownMenu defaultOpen><DropdownMenuTrigger>Menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={selected}>Settings</DropdownMenuItem><DropdownMenuItem>Downloads</DropdownMenuItem></DropdownMenuContent></DropdownMenu><FindInPage /></>)
    open()
    fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'Settings' } })
    await waitFor(() => expect(screen.getByLabelText('Find text')).toHaveFocus())
    fireEvent.keyDown(screen.getByLabelText('Find text'), { key: 'Enter' })
    expect(selected).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
  it('ignores composing shortcuts and refreshes DOM mutations', async () => {
    const { rerender } = render(<><main><p>Original</p></main><FindInPage /></>)
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, isComposing: true })
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    open()
    fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'Updated' } })
    expect(screen.getByRole('status')).toHaveTextContent('0/0')
    rerender(<><main><p>Updated</p></main><FindInPage /></>)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1/1'))
  })
})

it('uses macOS shortcuts without stealing native Ctrl+F or active IME', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  render(<><textarea aria-label="Editor" defaultValue="한글 needle needle" /><FindInPage /></>)
  screen.getByLabelText('Editor').focus()
  fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'f', metaKey: true, isComposing: true })
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'f', metaKey: true })
  const input = screen.getByLabelText('Find text') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'needle' } })
  await waitFor(() => expect(input).toHaveFocus())
  fireEvent.keyDown(window, { key: 'g', metaKey: true })
  expect(screen.getByRole('status')).toHaveTextContent('2/2')
  fireEvent.keyDown(window, { key: 'f', metaKey: true })
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(6)
})

it('closes stale Find when a new modal obscures its scope', async () => {
  render(<><main><p>needle</p></main><FindInPage /></>)
  open()
  fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'needle' } })
  document.querySelector('main')!.setAttribute('aria-hidden', 'true')
  await waitFor(() => expect(screen.queryByRole('search')).not.toBeInTheDocument())
})
