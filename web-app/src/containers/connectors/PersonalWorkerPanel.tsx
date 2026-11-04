import { useEffect, useState } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

type WorkerStatus = { supported: boolean; running: boolean; registered: boolean; enabledAtLogin?: boolean }
export default function PersonalWorkerPanel() {
  const service = useServiceHub()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<WorkerStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function call(action: string, enabled?: boolean) {
    const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_feature_settings', arguments: { action, ...(enabled === undefined ? {} : { enabled }) } })
    const text = result.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? ''
    if (result.error || ('isError' in result && result.isError)) throw new Error(text || String(result.error))
    const value = JSON.parse(text) as WorkerStatus
    if (typeof value.supported !== 'boolean' || typeof value.running !== 'boolean') throw new Error('Invalid background service status')
    return value
  }
  useEffect(() => {
    if (!open) return
    let active = true
    void call('worker_status').then(value => { if (active) setStatus(value) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
    // Service identity is stable. Changes are refreshed after each operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, open])
  async function perform(action: string, enabled?: boolean) {
    setBusy(true); setError('')
    try { setStatus(await call(action, enabled)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <details className="min-w-0" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Background service</summary>
    <p className="mt-2 text-sm text-muted-foreground">Optional and off by default. Keep scheduled tasks and folder monitoring running after quitting the app while you are logged in. Sleep can delay execution. Results appear in chat when the app reconnects.</p>
    {status && <div className="mt-3 flex min-w-0 flex-col gap-3">
      <p role="status" className="text-sm">{!status.supported ? 'Background service requires macOS' : status.running ? 'Background service running' : 'App only'}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !status.supported || status.running} onClick={() => void perform('worker_start')}>Start service</Button>
        <Button variant="outline" disabled={busy || !status.supported || !status.running} onClick={() => void perform('worker_stop')}>Stop service</Button>
        <Button variant="outline" disabled={busy} onClick={() => void perform('worker_status')}>Refresh</Button>
      </div>
      <label className="flex min-w-0 items-center gap-3"><span className="min-w-0 flex-1">Run at login</span>
        <Switch aria-label="Run Personal background service at login" checked={status.enabledAtLogin ?? false} disabled={busy || !status.supported} onCheckedChange={enabled => void perform('worker_login', enabled)} /></label>
      <p className="text-xs text-muted-foreground">Stopping this service does not stop tasks while the app remains connected. It does not enable additional tool permissions or keep the model server running.</p>
    </div>}
    {error && <p role="alert" className="mt-2 break-words text-sm text-destructive">{error}</p>}
  </details>
}
