import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { clearFindHighlight, paintFindHighlights, preserveFindFocus, domFindMatches, findHost, findScope, isSearchable, type FindMatch } from '@/lib/scoped-find'
import { apiActivityFindMatches } from '@/lib/api-activity-find'
import { conversationFindMatches } from '@/lib/conversation-find'

interface FindSession { scope: HTMLElement; host: HTMLElement; previous: HTMLElement | null }

/** App-owned Find, including Radix focus traps and multiline editor values. */
export function FindInPage() {
  const [session, setSession] = useState<FindSession | null>(null)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<FindMatch[]>([])
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const close = useCallback(() => {
    const previous = sessionRef.current?.previous
    setSession(null)
    if (previous?.isConnected) previous.focus({ preventScroll: true })
  }, [])
  const move = useCallback((direction: number) => {
    setIndex(current => matches.length ? (current + direction + matches.length) % matches.length : 0)
  }, [matches.length])

  const navigateFromButton = (direction: number) => {
    const field = input.current
    const start = field?.selectionStart
    const end = field?.selectionEnd
    field?.focus({ preventScroll: true })
    if (field && start != null && end != null) field.setSelectionRange(start, end)
    move(direction)
  }

  useLayoutEffect(() => {
    if (!session) { setMount(null); return }
    const container = document.createElement('div')
    container.dataset.atomicFindBar = ''
    Object.assign(container.style, session.host === document.body
      ? { position: 'fixed', top: '40px', right: '8px', width: '420px', maxWidth: 'calc(100vw - 16px)', zIndex: '100' }
      : { position: 'sticky', top: '0', zIndex: '100', minWidth: '0', maxWidth: '100%', gridColumn: '1 / -1' })
    session.host.insertBefore(container, session.host.firstChild)
    setMount(container)
    return () => container.remove()
  }, [session])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
      const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      const open = primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f'
      const next = sessionRef.current && primary && !event.altKey && event.key.toLowerCase() === 'g'
      const escape = sessionRef.current && event.key === 'Escape'
      if (!open && !next && !escape) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (escape) { close(); return }
      if (next) { move(event.shiftKey ? -1 : 1); return }
      const current = sessionRef.current
      if (current && input.current?.contains(document.activeElement)) {
        input.current.select()
        return
      }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const scope = findScope(active)
      setSession({ scope, host: findHost(scope), previous: active })
      setIndex(0)
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
    }
    // Capture before editor shortcuts, Radix typeahead, and native webview find.
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [close, move])

  useEffect(() => {
    if (!session) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (!session.scope.isConnected || !session.host.isConnected || !isSearchable(session.scope)) { setSession(null); return }
      const conversation = conversationFindMatches(session.scope, query)
      const activity = apiActivityFindMatches(session.scope, query)
      const results = conversation ? [...domFindMatches(session.scope, query, '[data-atomic-find-message]'), ...conversation] : (activity ? [...domFindMatches(session.scope, query, '[data-atomic-find-api-activity]'), ...activity] : domFindMatches(session.scope, query))
      setMatches(results)
      setIndex(current => Math.min(current, Math.max(0, results.length - 1)))
    }
    refresh()
    const observer = new MutationObserver(records => {
      if (records.every(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-atomic-find-bar], [data-atomic-find-ignore]') || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node instanceof Element && node.matches('[data-atomic-find-bar], [data-atomic-find-ignore]'))))) return
      clearTimeout(timer)
      timer = setTimeout(refresh, 80)
    })
    observer.observe(session.scope, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'data-state'] })
    // Observe route/layer removal as well as input values (not DOM attributes).
    const removalObserver = new MutationObserver(() => {
      if (!session.scope.isConnected || !isSearchable(session.scope)) setSession(null)
    })
    removalObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'inert'] })
    document.addEventListener('atomic-find-update', refresh)
    session.scope.addEventListener('input', refresh)
    return () => { observer.disconnect(); removalObserver.disconnect(); clearTimeout(timer); document.removeEventListener('atomic-find-update', refresh); session.scope.removeEventListener('input', refresh) }
  }, [session, query])

  useEffect(() => {
    clearFindHighlight()
    let cancel: void | (() => void) = undefined
    if (session) preserveFindFocus(() => {
      cancel = matches[index]?.reveal()
      paintFindHighlights(matches, index)
    })
    return () => { cancel?.(); clearFindHighlight() }
  }, [session, matches, index])
  if (!session || !mount) return null
  const match = matches[index]
  const start = match ? Math.max(0, match.start - 70) : 0
  const end = match ? Math.min(match.text.length, match.end + 100) : 0
  return createPortal(
    <section
      data-atomic-find-bar
      role="search"
      aria-label="Find in current view"
      className="z-[100] rounded-lg border bg-background text-foreground shadow-lg p-2 min-w-0"
      style={{ width: '100%', maxWidth: '100%' }}
      onKeyDown={event => {
        // Do not let menu typeahead, dialog forms, or composer shortcuts see Find typing.
        event.stopPropagation()
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); move(event.shiftKey ? -1 : 1) }
      }}
    >
      <style>{'[data-atomic-find-expanded] [data-atomic-find-api-field] { white-space: normal; overflow: visible; overflow-wrap: anywhere; -webkit-line-clamp: unset; } ::highlight(atomic-find-other) { background-color: #bae6fd; color: #111827; } ::highlight(atomic-find-current) { background-color: #facc15; color: #111827; text-decoration: underline; }'}</style>
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        <input ref={input} aria-label="Find text" placeholder="Find in this view" value={query}
          className="min-w-0 w-full basis-28 flex-1 rounded border bg-background px-2 py-1 outline-none focus:ring-2 focus:ring-ring"
          onChange={event => { setQuery(event.target.value); setIndex(0) }} />
        <span role="status" aria-live="polite" className="shrink-0 text-xs tabular-nums whitespace-nowrap">{query ? `${matches.length ? index + 1 : 0}/${matches.length}` : 'Find'}</span>
        <button type="button" className="shrink-0 rounded p-1 hover:bg-accent disabled:opacity-40" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!matches.length} onMouseDown={event => event.preventDefault()} onClick={() => navigateFromButton(-1)}><ChevronUp size={18} /></button>
        <button type="button" className="shrink-0 rounded p-1 hover:bg-accent disabled:opacity-40" aria-label="Next match" title="Next match (Enter)" disabled={!matches.length} onMouseDown={event => event.preventDefault()} onClick={() => navigateFromButton(1)}><ChevronDown size={18} /></button>
        <button type="button" className="shrink-0 rounded p-1 hover:bg-accent" aria-label="Close find" title="Close (Escape)" onClick={close}><X size={18} /></button>
      </div>
      {match && <p className="mt-1 max-h-24 overflow-auto text-xs whitespace-pre-wrap break-words" aria-label="Match preview">
        {match.label && <span className="block font-medium">{match.label}</span>}
        {start > 0 && '…'}{match.text.slice(start, match.start)}<mark>{match.text.slice(match.start, match.end)}</mark>{match.text.slice(match.end, end)}{end < match.text.length && '…'}
      </p>}
      {query && !matches.length && <p className="mt-1 text-xs">No matches in this view</p>}
    </section>, mount)
}
