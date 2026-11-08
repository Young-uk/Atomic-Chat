import { paintFindHighlights, scrollFindTarget, type FindTarget } from './find-highlight'
export { clearFindHighlight, paintFindHighlights } from './find-highlight'

/** Restore only a Find control that owned focus before synchronous reveal. */
export function preserveFindFocus(reveal: () => void): void {
  const active = document.activeElement
  const control = active instanceof HTMLElement && active.closest('[data-atomic-find-bar]') ? active : null
  const selection = control instanceof HTMLInputElement
    ? { start: control.selectionStart, end: control.selectionEnd, direction: control.selectionDirection } : null
  reveal()
  if (!control?.isConnected) return
  if (document.activeElement !== control) control.focus({ preventScroll: true })
  if (control instanceof HTMLInputElement && selection?.start != null && selection.end != null) {
    control.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined)
  }
}

/** Find only the current UI layer. Offscreen text is searchable; hidden data is not. */
export interface FindMatch {
  text: string
  label?: string
  start: number
  end: number
  target?: () => FindTarget | null
  reveal: () => void | (() => void)
}

export function occurrences(text: string, query: string): Array<{ start: number; end: number }> {
  if (!query) return []
  // A literal, Unicode-aware regexp preserves original UTF-16 selection offsets
  // even when case folding would change the length of a string.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return Array.from(text.matchAll(pattern), match => ({ start: match.index!, end: match.index! + match[0].length }))
}

export function isSearchable(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches('[hidden], [inert], [aria-hidden="true"], [data-atomic-find-bar], script, style, noscript, [data-atomic-find-ignore]')) return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

const layers = '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"], [data-slot="dropdown-menu-sub-content"]'
export function findScope(active: Element | null): HTMLElement {
  // A focused multiline editor is its own document, including its scrolled-out value.
  if ((active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) && (!active.closest('[data-atomic-find-conversation]') || active.closest('[data-atomic-find-message]')) && isSearchable(active)) return active
  const layer = active?.closest<HTMLElement>(layers)
  if (layer && isSearchable(layer)) return layer
  const openLayers = Array.from(document.querySelectorAll<HTMLElement>(layers)).filter(isSearchable)
  if (openLayers.length) return openLayers[openLayers.length - 1]
  return active?.closest<HTMLElement>('[data-atomic-find-conversation], nav, aside, [data-sidebar="sidebar"], main, [data-slot="sidebar-inset"]')
    ?? document.querySelector<HTMLElement>('[data-atomic-find-conversation], main, [data-slot="sidebar-inset"]') ?? document.body
}

export function findHost(scope: HTMLElement): HTMLElement {
  return scope.closest<HTMLElement>(layers) ?? document.body
}

function editorMatches(editor: HTMLTextAreaElement | HTMLInputElement, query: string): FindMatch[] {
  if (editor instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel'].includes(editor.type)) return []
  return occurrences(editor.value, query).map(({ start, end }) => {
    const value = editor.value
    const target = () => editor.isConnected && editor.value === value ? { editor, start, end } : null
    return { text: value, start, end, target, reveal: () => {
      const current = target()
      if (!current) return
      if ((document.activeElement === editor || document.activeElement?.closest('[data-atomic-find-bar]')) && (editor instanceof HTMLTextAreaElement || ['text', 'search', 'url', 'tel'].includes(editor.type))) editor.setSelectionRange(start, end)
      scrollFindTarget(current)
      paintFindHighlights([{ target }], 0)
    } }
  })
}

export function domFindMatches(scope: HTMLElement, query: string, exclude?: string): FindMatch[] {
  if (!query || !scope.isConnected) return []
  if (scope instanceof HTMLTextAreaElement || scope instanceof HTMLInputElement) return editorMatches(scope, query)
  const matches: FindMatch[] = []
  // Join inline text nodes, but never match across separate paragraphs/controls.
  const groups = new Map<Element, Text[]>()
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || (exclude && parent.closest(exclude)) || !isSearchable(parent) || parent.closest('textarea, input, select, option')) continue
    let block = parent
    while (block.parentElement && block !== scope && ['', 'inline', 'contents'].includes(getComputedStyle(block).display)) block = block.parentElement
    const nodes = groups.get(block) ?? []
    nodes.push(node as Text)
    groups.set(block, nodes)
  }
  for (const nodes of groups.values()) {
    const text = nodes.map(node => node.data).join('')
    for (const { start, end } of occurrences(text, query)) {
      const target = () => {
        const range = document.createRange()
        let offset = 0
        let started = false
        for (const node of nodes) {
          if (!node.isConnected) return null
          if (!started && start < offset + node.length) { range.setStart(node, start - offset); started = true }
          if (started && end <= offset + node.length) { range.setEnd(node, end - offset); return range }
          offset += node.length
        }
        return null
      }
      matches.push({ text, start, end, target, reveal: () => {
        const range = target()
        if (!range) return
        scrollFindTarget(range)
        paintFindHighlights([{ target }], 0)
      } })
    }
  }
  for (const editor of scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if ((!exclude || !editor.closest(exclude)) && isSearchable(editor)) matches.push(...editorMatches(editor, query))
  }
  return matches
}
