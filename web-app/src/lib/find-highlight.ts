/** Paint Find without changing React-owned text or the user's Selection. */
export type FindTarget = Range | { editor: HTMLInputElement | HTMLTextAreaElement; start: number; end: number }
type TargetMatch = { target?: () => FindTarget | null }
type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void }
const CURRENT = 'atomic-find-current'
const OTHER = 'atomic-find-other'
let dispose: (() => void) | undefined

function highlightApi() {
  return {
    registry: (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights,
    HighlightClass: (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => { priority?: number } }).Highlight,
  }
}

export function clearFindHighlight(): void {
  dispose?.()
  dispose = undefined
  const { registry } = highlightApi()
  registry?.delete(CURRENT)
  registry?.delete(OTHER)
}

function targetElement(target: FindTarget): HTMLElement | null {
  return target instanceof Range ? target.startContainer.parentElement : target.editor
}

/** Mirror native editor layout; never replace its value or keyboard focus. */
function withEditorRange<T>(target: Exclude<FindTarget, Range>, read: (range: Range, mirror: HTMLDivElement) => T): T {
  const { editor, start, end } = target
  const style = getComputedStyle(editor)
  const mirror = document.createElement('div')
  mirror.dataset.atomicFindIgnore = ''
  mirror.setAttribute('aria-hidden', 'true')
  for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'letter-spacing', 'text-indent', 'text-align', 'text-transform', 'tab-size', 'word-break', 'overflow-wrap', 'direction', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
    mirror.style.setProperty(property, style.getPropertyValue(property))
  }
  Object.assign(mirror.style, {
    position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    boxSizing: 'border-box', border: '0', margin: '0', width: `${editor.clientWidth}px`,
    whiteSpace: editor instanceof HTMLTextAreaElement && editor.wrap !== 'off' ? 'pre-wrap' : 'pre',
  })
  const node = document.createTextNode(editor.value + '\u200b')
  mirror.append(node)
  document.body.append(mirror)
  try {
    const range = document.createRange()
    range.setStart(node, Math.min(start, editor.value.length))
    range.setEnd(node, Math.min(end, editor.value.length))
    return read(range, mirror)
  } finally { mirror.remove() }
}

function targetRects(target: FindTarget): DOMRect[] {
  if (target instanceof Range) return Array.from(target.getClientRects?.() ?? [])
  return withEditorRange(target, (range, mirror) => {
    const box = target.editor.getBoundingClientRect()
    const origin = mirror.getBoundingClientRect()
    return Array.from(range.getClientRects?.() ?? [], rect => new DOMRect(
      box.left + target.editor.clientLeft + rect.left - origin.left - target.editor.scrollLeft,
      box.top + target.editor.clientTop + rect.top - origin.top - target.editor.scrollTop,
      rect.width, rect.height
    ))
  })
}

/** Center the occurrence, not the enclosing (potentially thousands-line) paragraph. */
export function scrollFindTarget(target: FindTarget): void {
  const element = targetElement(target)
  if (!element?.isConnected) return
  if (!(target instanceof Range)) {
    element.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' })
    withEditorRange(target, range => {
      const rect = range.getBoundingClientRect?.()
      if (!rect) return
      target.editor.scrollTop = Math.max(0, rect.top - target.editor.clientHeight / 2)
      target.editor.scrollLeft = Math.max(0, rect.left - target.editor.clientWidth / 2)
    })
  }
  // Work from the innermost viewport out. Read the rect again after each
  // scroll, since nested scroll containers change the match's client position.
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const vertical = /(auto|scroll|hidden)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight
    const horizontal = /(auto|scroll|hidden)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth
    if (!vertical && !horizontal) continue
    const rect = targetRects(target)[0]
    if (!rect) continue
    const box = parent.getBoundingClientRect()
    const bar = parent.querySelector<HTMLElement>('[data-atomic-find-bar]')?.getBoundingClientRect()
    const reserved = bar && bar.top <= box.top + 2 ? bar.height : 0
    if (vertical) parent.scrollTop += rect.top + rect.height / 2 - (box.top + reserved + (parent.clientHeight - reserved) / 2)
    if (horizontal && (rect.left < box.left || rect.right > box.right)) parent.scrollLeft += rect.left + rect.width / 2 - (box.left + parent.clientWidth / 2)
  }
  const rect = targetRects(target)[0]
  if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
    window.scrollBy?.({ top: rect.top + rect.height / 2 - window.innerHeight / 2, behavior: 'instant' })
  }
}

function clipRect(rect: DOMRect, element: HTMLElement): DOMRect | null {
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom)
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || node.hidden) return null
    const box = node.getBoundingClientRect()
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || /(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, box.left + node.clientLeft); right = Math.min(right, box.left + node.clientLeft + node.clientWidth)
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || /(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, box.top + node.clientTop); bottom = Math.min(bottom, box.top + node.clientTop + node.clientHeight)
    }
  }
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null
}

/** Custom Highlight when available, rectangle overlays for older WKWebView and editors. */
export function paintFindHighlights(matches: readonly TargetMatch[], current: number): void {
  clearFindHighlight()
  if (!matches.length) return
  const overlay = document.createElement('div')
  overlay.dataset.atomicFindIgnore = ''
  overlay.dataset.atomicFindOverlay = ''
  overlay.setAttribute('aria-hidden', 'true')
  Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '99', overflow: 'hidden' })
  document.body.append(overlay)
  let frame = 0
  const paint = () => {
    frame = 0
    const { registry, HighlightClass } = highlightApi()
    const normal: Range[] = [], selected: Range[] = []
    const fragments = document.createDocumentFragment()
    matches.forEach((match, index) => {
      const target = match.target?.()
      const element = target && targetElement(target)
      if (!target || !element?.isConnected) return
      if (target instanceof Range && registry && HighlightClass) {
        const ranges = index === current ? selected : normal
        ranges.push(target)
        return
      }
      for (const rect of targetRects(target)) {
        const clipped = clipRect(rect, element)
        if (!clipped) continue
        const mark = document.createElement('span')
        mark.dataset.atomicFindRect = index === current ? 'current' : 'other'
        Object.assign(mark.style, {
          position: 'absolute', left: `${clipped.left}px`, top: `${clipped.top}px`,
          width: `${clipped.width}px`, height: `${clipped.height}px`, borderRadius: '2px',
          background: index === current ? 'rgba(250, 204, 21, .48)' : 'rgba(125, 211, 252, .30)',
          outline: index === current ? '2px solid #d97706' : '1px solid rgba(2,132,199,.55)',
          outlineOffset: '-1px',
        })
        fragments.append(mark)
      }
    })
    overlay.replaceChildren(fragments)
    if (registry && HighlightClass) {
      registry.set(OTHER, new HighlightClass(...normal))
      const highlight = new HighlightClass(...selected)
      highlight.priority = 1
      registry.set(CURRENT, highlight)
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint) }
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  document.addEventListener('atomic-find-target', schedule)
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  observer?.observe(document.body)
  dispose = () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('atomic-find-target', schedule)
    observer?.disconnect()
    overlay.remove()
  }
  paint()
}
