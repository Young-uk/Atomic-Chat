import { useEffect, useState } from 'react'
import { Check, FileText, Loader2, AlertCircle, Pause } from 'lucide-react'
import { useContextSummaryProgress } from '@/lib/context-summary-progress'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Background work has a separate, thread-scoped indicator. Request-in-flight
 * includes server queue time; it must never pretend to observe GPU scheduling. */
export function ContextSummaryProgress({ threadId }: { threadId: string }) {
  const progress = useContextSummaryProgress(s => s.byThread[threadId])
  const { t } = useTranslation('chat')
  const [now, setNow] = useState(Date.now)
  const startedAt = progress?.startedAt
  const phase = progress?.phase
  const finishedAt = progress?.finishedAt
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(Date.now())
    if (phase === 'failed') return
    if (phase === 'ready') {
      const timer = setTimeout(() => setNow(Date.now()), Math.max(0, (finishedAt ?? Date.now()) + 5000 - Date.now()))
      return () => clearTimeout(timer)
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt, phase, finishedAt])
  if (!progress || (progress.phase === 'ready' && now - (progress.finishedAt ?? now) >= 5000)) return null
  const seconds = Math.max(0, Math.floor(((progress.finishedAt ?? now) - progress.startedAt) / 1000))
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const Icon = progress.phase === 'ready' ? Check : progress.phase === 'failed' ? AlertCircle : progress.phase === 'paused' ? Pause : Loader2
  return (
    <details className="my-2 min-w-0 max-w-full text-xs text-muted-foreground">
      <summary className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
        <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${progress.finishedAt || progress.phase === 'paused' ? '' : 'animate-spin'}`} />
        <span role="status" aria-live="polite" className="min-w-0 break-words">{t(`contextSummary.${progress.phase}`)}</span>
        <span className="shrink-0 tabular-nums">{elapsed}</span>
      </summary>
      <div className="mt-1 min-w-0 space-y-1 break-words pl-5">
        <p>{t('contextSummary.sections', { count: progress.completed })}</p>
        <p className="flex items-start gap-1"><FileText aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{t(progress.archived ? 'contextSummary.archived' : 'contextSummary.retained')}</p>
        {progress.phase === 'summarizing' && <p>{t('contextSummary.background')}</p>}
      </div>
    </details>
  )
}
