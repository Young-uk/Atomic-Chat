import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'

type Review = { id: number; createdAt: number; undoneAt?: number; changes: { id: number; activation: string; principle: string; evidence: { id: string; quote: string }[]; steps: { text: string }[] }[] }
export default function BackgroundReviewHistory() {
  const service = useServiceHub(), { t } = useTranslation()
  const [rows, setRows] = useState<Review[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(false)
  async function call(action: 'history' | 'undo', id?: number) {
    const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_memory_lifecycle', arguments: { action, ...(id === undefined ? {} : { id }) } })
    if (result.error || ('isError' in result && result.isError)) throw new Error('Review unavailable')
    return JSON.parse(result.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? 'null')
  }
  async function refresh(id?: number) {
    if (busy) return
    setBusy(true); setError(false)
    try {
      if (id !== undefined) await call('undo', id)
      const value = await call('history')
      if (!Array.isArray(value)) throw new Error('Invalid review history')
      setRows(value)
    } catch { setError(true) } finally { setBusy(false) }
  }
  return <details className="min-w-0" onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open) void refresh() }}>
    <summary>{t('tools:features.reviewHistory')}</summary>
    <Button className="mt-2" disabled={busy} onClick={() => void refresh()}>{t('tools:features.reviewRefresh')}</Button>
    {busy && <p role="status">{t('tools:features.reviewLoading')}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{t('tools:features.reviewFailed')}</p>}
    {!busy && !rows.length && <p className="text-sm text-muted-foreground">{t('tools:features.reviewEmpty')}</p>}
    <div className="mt-2 flex max-h-96 min-w-0 flex-col gap-3 overflow-y-auto">
      {rows.map(row => <article key={row.id} className="min-w-0 rounded border p-3 text-sm [overflow-wrap:anywhere]">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <time className="min-w-0" dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString()}</time>
          <Button disabled={busy || !!row.undoneAt} onClick={() => void refresh(row.id)}>{t(row.undoneAt ? 'tools:features.reviewUndone' : 'tools:features.reviewUndo')}</Button>
        </div>
        {row.changes.map(change => <div key={change.id} className="mt-2 min-w-0">
          <p className="font-medium">{change.activation}</p><p>{change.principle}</p>
          {!!change.steps.length && <ol className="list-inside list-decimal">{change.steps.map((step, index) => <li key={index}>{step.text}</li>)}</ol>}
          <details className="mt-1 min-w-0"><summary>{t('tools:features.reviewEvidence')}</summary>
            {change.evidence.map((ref, index) => <blockquote key={index} className="mt-1 border-l-2 pl-2 whitespace-pre-wrap">{ref.quote}</blockquote>)}
          </details>
        </div>)}
      </article>)}
    </div>
  </details>
}
