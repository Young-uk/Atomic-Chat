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
  const input = ['queued', 'paused', 'summarizing'].includes(progress.phase) ? progress.input : undefined
  const hasCounts = input && Number.isSafeInteger(input.processed) && Number.isSafeInteger(input.total) &&
    input.total! > 0 && input.processed! >= 0 && input.processed! <= input.total!
  // Percentages describe unread input only, never summary output completion.
  const reading = input?.phase === 'reading' && hasCounts && input.processed! < input.total!
  const percentage = reading ? Math.floor(input.processed! / input.total! * 1000) / 10 : undefined
  const fields = [t('contextSummary.elapsed', { time: elapsed })]
  if (progress.method) fields.push(t(`contextSummary.method_${progress.method}`))
  if (progress.fallbackReason) fields.push(t(`contextSummary.fallback_${progress.fallbackReason}`))
  if (Number.isSafeInteger(input?.request) && input!.request! > 0)
    fields.push(t('contextSummary.request', { count: input!.request }))
  if (input?.phase === 'saving-state') fields.push(t('contextSummary.savingState'))
  else if (input?.phase === 'restoring-state') fields.push(t('contextSummary.restoringState'))
  else if (input?.phase === 'waiting-memory') fields.push(t('contextSummary.waitingMemory'))
  else if (input?.phase === 'preparing') fields.push(t('contextSummary.inputPreparing'))
  else if (input?.phase === 'generating' || (hasCounts && input.processed === input.total)) {
    fields.push(hasCounts
      ? t('contextSummary.inputCompleteTokens', { tokens: input.total!.toLocaleString() })
      : t('contextSummary.inputComplete'))
    fields.push(t(input?.phase === 'generating' ? 'contextSummary.generating' : 'contextSummary.generationPreparing'))
  } else if (input?.phase === 'reading') {
    fields.push(`${t('inferenceProgress.reading')}${percentage !== undefined ? ` ${percentage}%` : ''}`)
    if (hasCounts) fields.push(t('inferenceProgress.tokens', {
      processed: input.processed!.toLocaleString(), total: input.total!.toLocaleString(),
    }))
  }
  if (Number.isSafeInteger(input?.cache) && input!.cache! > 0)
    fields.push(t('inferenceProgress.cached', { tokens: input!.cache!.toLocaleString() }))
  const Icon = progress.phase === 'ready' ? Check : progress.phase === 'failed' ? AlertCircle : progress.phase === 'paused' ? Pause : Loader2
  return (
    <details className="my-2 min-w-0 max-w-full text-xs text-muted-foreground">
      <summary className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden" aria-hidden="true">
          <Icon className={`size-3.5 ${progress.finishedAt || progress.phase === 'paused' ? '' : 'animate-spin'}`} />
        </span>
        <span role="status" aria-live="polite" className="min-w-0 break-words">{t(`contextSummary.${progress.phase}`)}</span>
        {fields.map((field, index) => <span key={index} className="inline-flex min-w-0 items-baseline gap-x-2 tabular-nums">
          <span aria-hidden="true" className="shrink-0">·</span>
          <span className="min-w-0 break-words">{field}</span>
        </span>)}
        {percentage !== undefined && <span role="progressbar" aria-label={t('inferenceProgress.reading')}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}
          className="h-1.5 basis-full overflow-hidden rounded-full bg-muted">
          <span className="block h-full bg-primary transition-[width]" style={{ width: `${percentage}%` }} />
        </span>}
      </summary>
      <div className="mt-1 min-w-0 space-y-1 break-words pl-5">
        <p>{t('contextSummary.sections', { count: progress.completed })}</p>
        <p className="flex items-start gap-1"><FileText aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{t(progress.archived ? 'contextSummary.archived' : 'contextSummary.retained')}</p>
        {progress.phase === 'summarizing' && <p>{t('contextSummary.background')}</p>}
      </div>
    </details>
  )
}
