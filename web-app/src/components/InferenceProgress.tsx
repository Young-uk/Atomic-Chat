import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useInferenceProgress } from '@/lib/inference-progress'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Request-scoped status stays visible through prefill, reasoning and decoding. */
export function InferenceProgress({ threadId }: { threadId: string }) {
  const progress = useInferenceProgress((state) => state.byThread[threadId])
  const { t } = useTranslation('chat')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!progress?.requestId) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [progress?.requestId])
  if (!progress) return null
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000))
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const hasCounts = progress.phase === 'reading' && Number.isSafeInteger(progress.processed) &&
    Number.isSafeInteger(progress.total) && progress.total! > 0 && progress.processed! >= 0 &&
    progress.processed! <= progress.total!
  const percentage = hasCounts
    ? Math.floor(progress.processed! / progress.total! * 1000) / 10
    : undefined
  return (
    <div role="status" aria-live="polite" className="my-2 min-w-0 max-w-full text-sm text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden" aria-hidden="true">
          <Loader2 className="size-3.5 animate-spin" />
        </span>
        <span className="min-w-0 break-words">{t(`inferenceProgress.${progress.phase}`)}</span>
        {percentage !== undefined && <span className="shrink-0 tabular-nums">{percentage}%</span>}
        <span className="inline-flex min-w-0 items-baseline gap-x-2 tabular-nums">
          <span aria-hidden="true">·</span><span>{t('inferenceProgress.elapsed', { time: elapsed })}</span>
        </span>
      </div>
      {hasCounts && <div className="mt-1 min-w-0 break-words tabular-nums">
        {t('inferenceProgress.tokens', { processed: progress.processed!.toLocaleString(), total: progress.total!.toLocaleString() })}
        {Number.isSafeInteger(progress.cache) && progress.cache! > 0 && <span className="ml-2">
          <span aria-hidden="true">· </span>{t('inferenceProgress.cached', { tokens: progress.cache!.toLocaleString() })}
        </span>}
      </div>}
      {percentage !== undefined && (
        <div role="progressbar" aria-label={t('inferenceProgress.reading')}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percentage}%` }} />
        </div>
      )}
    </div>
  )
}
