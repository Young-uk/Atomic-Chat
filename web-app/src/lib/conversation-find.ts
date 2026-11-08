import { useEffect, type RefObject } from 'react'
import { openFindDisclosure, revealFindTarget } from './find-reveal'
import { domFindMatches, isSearchable, type FindMatch } from './scoped-find'

/** User-readable message parts; tool results use an explicit display-text allowlist. */
type FindMessage = {
  id: string
  role?: string
  parts: readonly { type: string; text?: unknown; output?: unknown; errorText?: unknown }[]
}

export type ConversationFindMatch = FindMatch

// Match only display-text containers used by tool renderers. Deliberately do
// not walk arbitrary objects, input arguments, image data or metadata.
const toolTextFields = new Set([
  'text', 'content', 'stdout', 'stderr', 'message', 'title', 'highlights',
  'snippet', 'snippets', 'description', 'results', 'pages', 'items',
])

function toolOutputText(value: unknown, depth = 0): string[] {
  if (depth > 12) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(item => toolOutputText(item, depth + 1))
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  if (typeof object.type === 'string' && ['image', 'audio', 'file', 'resource'].includes(object.type)) return []
  return Object.entries(object).flatMap(([key, child]) =>
    toolTextFields.has(key) ? toolOutputText(child, depth + 1) : []
  )
}

function messagePartText(part: FindMessage['parts'][number]): string[] {
  if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string') return [part.text]
  if (!part.type.startsWith('tool-') || part.type === 'tool-reply' || part.type === 'tool-finish') return []
  return [
    ...toolOutputText(part.output),
    ...(typeof part.errorText === 'string' ? [part.errorText] : []),
  ]
}

type Registration = { messages: readonly FindMessage[]; revealMessage?: (id: string) => void }
const conversations = new WeakMap<HTMLElement, Registration>()

export function registerConversationFind(
  root: HTMLElement,
  messages: readonly FindMessage[],
  revealMessage?: (id: string) => void
): () => void {
  const registration = { messages, revealMessage }
  conversations.set(root, registration)
  root.setAttribute('data-atomic-find-conversation', '')
  document.dispatchEvent(new Event('atomic-find-update'))
  return () => {
    if (conversations.get(root) !== registration) return
    conversations.delete(root)
    root.removeAttribute('data-atomic-find-conversation')
    document.dispatchEvent(new Event('atomic-find-update'))
  }
}

export function useConversationFind(
  root: RefObject<HTMLElement | null>,
  messages: readonly FindMessage[],
  revealMessage?: (id: string) => void
): void {
  useEffect(() => {
    if (root.current) return registerConversationFind(root.current, messages, revealMessage)
  }, [root, messages, revealMessage])
}

/**
 * Rendered message bodies are authoritative: markdown punctuation and link
 * destinations are not visible text. Missing bodies and collapsed reasoning /
 * tool output use route-owned source data. Reveal opens only registered disclosures;
 * it never clicks tool actions or edits message content.
 */
export function conversationFindMatches(
  root: HTMLElement,
  query: string
): ConversationFindMatch[] | null {
  const scope = conversations.has(root)
    ? root
    : root.querySelector<HTMLElement>('[data-atomic-find-conversation]')
  const messages = scope && conversations.get(scope)?.messages
  if (!scope || !messages) return null
  if (!query) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const matches: ConversationFindMatch[] = []
  const anchors = new Map(Array.from(scope.querySelectorAll<HTMLElement>('[data-atomic-find-message]'), element => [element.dataset.atomicFindMessage, element]))
  for (const message of messages) {
    const anchor = anchors.get(message.id)
    const hasRenderedBody = Boolean(anchor && Array.from(
      anchor.querySelectorAll<HTMLElement>('[data-atomic-find-rendered-text]')
    ).some(isSearchable))
    // Text/code bodies are fully rendered by MessageItem today. This explicit
    // contract avoids guessing how raw markdown maps to visible occurrences.
    if (hasRenderedBody && anchor) {
      matches.push(...domFindMatches(anchor, query, '[data-reasoning-viewport], [data-testid="tool-activity-group"]')
        .map(match => ({ ...match, label: 'Rendered message' })))
    }
    let reasoningOrdinal = 0
    let textOrdinal = 0
    for (const [partIndex, part] of message.parts.entries()) {
      let partOrdinal = 0
      if (part.type === 'text' && hasRenderedBody) continue
      for (const text of messagePartText(part)) {
        for (const match of text.matchAll(pattern)) {
          const ordinal = part.type === 'reasoning' ? reasoningOrdinal++ : part.type === 'text' ? textOrdinal++ : partOrdinal++
          const messageAnchor = () => Array.from(scope.querySelectorAll<HTMLElement>('[data-atomic-find-message]'))
            .find(element => element.dataset.atomicFindMessage === message.id)
          const toolAnchor = () => Array.from(messageAnchor()?.querySelectorAll<HTMLElement>('[data-atomic-find-tool]') ?? [])
            .find(element => element.dataset.atomicFindTool === `${message.id}-${partIndex}`)
          const target = () => {
            const current = messageAnchor()
            const body = part.type === 'reasoning' ? current?.querySelector<HTMLElement>('[data-reasoning-viewport]')
              : part.type.startsWith('tool-') ? toolAnchor()?.querySelector<HTMLElement>('[data-atomic-find-tool-content]') : current
            if (!body || !isSearchable(body) || body.closest('[data-state="closed"]')) return null
            return domFindMatches(body, query, part.type === 'text' ? '[data-reasoning-viewport], [data-testid="tool-activity-group"]' : '[data-atomic-find-tool-input]')[ordinal]?.target?.() ?? null
          }
          matches.push({
            text,
            label: part.type === 'reasoning' ? 'Reasoning' : part.type.startsWith('tool-')
              ? 'Tool output' : message.role === 'user' ? 'User message' : 'Assistant message',
            start: match.index,
            end: match.index + match[0].length,
            target,
            reveal: () => {
              if (!scope.isConnected || !conversations.get(scope)?.messages.some(item => item.id === message.id)) return
              if (!messageAnchor()) conversations.get(scope)?.revealMessage?.(message.id)
              return revealFindTarget(scope, () => {
                const current = messageAnchor()
                if (part.type === 'reasoning') openFindDisclosure(current?.querySelector('[data-atomic-find-reasoning]'))
                else if (part.type.startsWith('tool-')) {
                  openFindDisclosure(current?.querySelector('[data-testid="tool-activity-group"]'))
                  openFindDisclosure(toolAnchor())
                }
              }, target)
            },
          })
        }
      }
    }
  }
  return matches
}
