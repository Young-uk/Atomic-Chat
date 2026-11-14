import { useEffect, useRef, type RefObject } from 'react'
import { revealFindTarget } from './find-reveal'

export const HISTORY_OPEN_EVENT = 'atomic-chat-history-open'
export type HistoryLocation = { threadId: string; messageId: string }
export function parseHistoryLink(href: unknown): HistoryLocation | undefined {
  if (typeof href !== 'string') return undefined
  try {
    const url = href.startsWith('/threads/') ? new URL(href, 'tauri://localhost') : new URL(href)
    const match = /^\/threads\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname)
    const messageId = url.searchParams.get('historyMessage')
    if (url.protocol !== 'tauri:' || url.hostname !== 'localhost' || url.username || url.password || url.port || url.hash || !match || !messageId || !/^[A-Za-z0-9_-]{1,250}$/.test(messageId) || [...url.searchParams.keys()].some(key => key !== 'historyMessage') || url.searchParams.getAll('historyMessage').length !== 1) return undefined
    return { threadId: match[1], messageId }
  } catch { return undefined }
}
export function openHistoryLink(href: unknown): boolean {
  if (!parseHistoryLink(href)) return false
  window.dispatchEvent(new CustomEvent(HISTORY_OPEN_EVENT, { detail: href }))
  return true
}

/** Use normal app navigation and the existing Find reveal/scroll machinery.
 * A source click never submits a model request or changes message history. */
export function useChatHistoryNavigation(
  root: RefObject<HTMLElement | null>, threadId: string, messageId: string | undefined,
  messages: readonly { id: string }[], onOpen: (location: HistoryLocation) => void
) {
  const revealed = useRef('')
  useEffect(() => {
    const listener = (event: Event) => {
      const location = parseHistoryLink((event as CustomEvent<unknown>).detail)
      if (location) { revealed.current = ''; onOpen(location) }
    }
    const node = root.current
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      const location = parseHistoryLink(link?.getAttribute('href'))
      if (!location) return
      // Citation renderers may override Markdown's anchor component. Capture
      // the local source before an external-link handler can open a window.
      event.preventDefault(); event.stopPropagation()
      revealed.current = ''; onOpen(location)
    }
    node?.addEventListener('click', click, true)
    window.addEventListener(HISTORY_OPEN_EVENT, listener)
    return () => { node?.removeEventListener('click', click, true); window.removeEventListener(HISTORY_OPEN_EVENT, listener) }
  }, [root, onOpen])
  useEffect(() => {
    const key = `${threadId}/${messageId}`
    if (!messageId || revealed.current === key || !root.current || !messages.some(row => row.id === messageId)) return
    return revealFindTarget(root.current, () => {}, () => {
      const node = [...root.current!.querySelectorAll<HTMLElement>('[data-atomic-find-message]')]
        .find(element => element.dataset.atomicFindMessage === messageId)
      if (!node) return null
      const body = node.querySelector('[data-atomic-find-rendered-text]') ?? node
      const range = document.createRange()
      range.selectNodeContents(body.firstElementChild ?? body)
      revealed.current = key
      return range
    })
  }, [root, threadId, messageId, messages])
}
