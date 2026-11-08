import { domFindMatches, type FindMatch } from './scoped-find'
import { revealFindTarget } from './find-reveal'
import { useEffect, type RefObject } from 'react'

import type { ApiLogEntry } from '@/types/apiServerLog'
import { endpointLabel } from '@/utils/apiServerLogNormalize'
import { formatMs, formatTime } from '@/utils/apiServerStats'

/** Shared with the rendered row so find uses the same generation-rate label. */
export function apiActivityRowRate(entry: ApiLogEntry): number | null {
  if (entry.kind !== 'request') return null
  if (entry.predictedPerSecond) return entry.predictedPerSecond
  if (!entry.completionTokens || !entry.durationMs) return null
  const generationMs = Math.max(entry.durationMs - (entry.ttftMs ?? 0), 1)
  return entry.completionTokens / (generationMs / 1000)
}

/** Only the labels actually rendered by ApiRequestRow, never raw log metadata. */
export function apiActivityRowText(entry: ApiLogEntry): string[] {
  if (entry.kind === 'event') {
    return [entry.title, entry.detail ?? '', formatTime(entry.startedAt)]
  }
  const rate = apiActivityRowRate(entry)
  return [
    endpointLabel(entry.endpoint),
    entry.durationMs !== undefined ? formatMs(entry.durationMs) : '',
    entry.model ?? '—',
    rate ? `${rate.toFixed(1)} tok/s` : '',
    formatTime(entry.startedAt),
    entry.replyPreview ?? entry.promptPreview ?? '',
  ]
}

type Registration = {
  entries: readonly ApiLogEntry[]
  revealIndex: (index: number) => void
}
export type ApiActivityFindMatch = FindMatch

const activityLists = new WeakMap<HTMLElement, Registration>()

export function registerApiActivityFind(
  root: HTMLElement,
  entries: readonly ApiLogEntry[],
  revealIndex: (index: number) => void
): () => void {
  const registration = { entries, revealIndex }
  activityLists.set(root, registration)
  root.setAttribute('data-atomic-find-api-activity', '')
  document.dispatchEvent(new Event('atomic-find-update'))
  return () => {
    if (activityLists.get(root) !== registration) return
    activityLists.delete(root)
    root.removeAttribute('data-atomic-find-api-activity')
    document.dispatchEvent(new Event('atomic-find-update'))
  }
}

export function useApiActivityFind(
  root: RefObject<HTMLElement | null>,
  entries: readonly ApiLogEntry[],
  revealIndex: (index: number) => void
): void {
  useEffect(() => {
    // Leave the empty-state labels to the normal DOM finder.
    if (root.current && entries.length) {
      return registerApiActivityFind(root.current, entries, revealIndex)
    }
  }, [root, entries, revealIndex])
}

/** Search currently loaded, filtered rows without requesting any further data. */
export function apiActivityFindMatches(
  root: HTMLElement,
  query: string
): ApiActivityFindMatch[] | null {
  const scope = activityLists.has(root)
    ? root
    : root.querySelector<HTMLElement>('[data-atomic-find-api-activity]')
  const registration = scope && activityLists.get(scope)
  if (!scope || !registration) return null
  if (!query) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const matches: ApiActivityFindMatch[] = []
  for (const entry of registration.entries) {
    for (const [fieldIndex, text] of apiActivityRowText(entry).entries()) {
      let occurrence = 0
      for (const match of text.matchAll(pattern)) {
        const ordinal = occurrence++
        const row = () => Array.from(scope.querySelectorAll<HTMLElement>('[data-atomic-find-api-row]'))
          .find(element => element.dataset.atomicFindApiRow === entry.id)
        const target = () => {
          const field = row()?.querySelector<HTMLElement>(`[data-atomic-find-api-field="${fieldIndex}"]`)
          return field ? domFindMatches(field, query)[ordinal]?.target?.() ?? null : null
        }
        matches.push({
          text,
          start: match.index,
          end: match.index + match[0].length,
          target,
          reveal: () => {
            if (!scope.isConnected) return
            const current = activityLists.get(scope)
            // Resolve by identity in the latest ordering, not the captured index.
            const index = current?.entries.findIndex(row => row.id === entry.id) ?? -1
            if (index < 0) return
            current?.revealIndex(index)
            const expanded = new Set<HTMLElement>()
            const cancel = revealFindTarget(scope, () => {
              const element = row()
              if (element && !element.hasAttribute('data-atomic-find-expanded')) {
                element.setAttribute('data-atomic-find-expanded', '')
                expanded.add(element)
              }
            }, target)
            return () => { cancel(); expanded.forEach(element => element.removeAttribute('data-atomic-find-expanded')) }
          },
        })
      }
    }
  }
  return matches
}
