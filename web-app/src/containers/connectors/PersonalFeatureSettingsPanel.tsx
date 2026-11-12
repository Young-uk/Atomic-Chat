import { useEffect, useState } from 'react'
import BackgroundReviewHistory from './BackgroundReviewHistory'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'

type Features = { version: 1; memoryMaintenance: { enabled: boolean; queryRewrite: boolean; backgroundReview: boolean }; semanticMemory: { enabled: boolean; url: string; model: string; dimensions: number } }
export default function PersonalFeatureSettingsPanel() {
  const service = useServiceHub(), { t } = useTranslation()
  const [settings, setSettings] = useState<Features>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function call(action: 'get' | 'set', settings?: Features) {
    const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_feature_settings', arguments: { action, ...(settings ? { settings } : {}) } })
    if (result.error || ('isError' in result && result.isError)) throw new Error(t('tools:features.failed'))
    const text = result.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? ''
    const value = JSON.parse(text) as Features
    if (value.version !== 1 || typeof value.semanticMemory?.enabled !== 'boolean' || typeof value.semanticMemory.url !== 'string' || typeof value.semanticMemory.model !== 'string' || !Number.isInteger(value.semanticMemory.dimensions)) throw new Error(t('tools:features.failed'))
    return value
  }
  useEffect(() => {
    let active = true
    void call('get').then(value => { if (active) setSettings(value) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
    // The service identity is stable; editing a field must not reload settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service])
  const update = (patch: Partial<Features['semanticMemory']>) => setSettings(current => current && ({ ...current, semanticMemory: { ...current.semanticMemory, ...patch } }))
  return <details className="min-w-0">
    <summary>{t('tools:features.title')}</summary>
    <p className="mt-2 text-sm text-muted-foreground">{t('tools:features.description')}</p>
    {settings && <div className="mt-3 flex min-w-0 flex-col gap-3">
      <label className="flex min-w-0 items-center gap-3"><span className="min-w-0 flex-1">{t('tools:features.enabled')}</span>
        <Switch aria-label={t('tools:features.enabled')} checked={settings.semanticMemory.enabled} onCheckedChange={enabled => update({ enabled })} /></label>
      <label className="min-w-0 text-sm">{t('tools:features.url')}<Input value={settings.semanticMemory.url} onChange={e => update({ url: e.target.value })} /></label>
      <label className="min-w-0 text-sm">{t('tools:features.model')}<Input value={settings.semanticMemory.model} onChange={e => update({ model: e.target.value })} /></label>
      <label className="min-w-0 text-sm">{t('tools:features.dimensions')}<Input type="number" min={1} max={8192} value={settings.semanticMemory.dimensions} onChange={e => update({ dimensions: Number(e.target.value) })} /></label>
      <label className="flex min-w-0 items-center gap-3"><span className="min-w-0 flex-1">{t('tools:features.maintenance')}</span>
        <Switch aria-label={t('tools:features.maintenance')} checked={settings.memoryMaintenance?.enabled ?? false} onCheckedChange={enabled => setSettings({ ...settings, memoryMaintenance: { ...settings.memoryMaintenance, enabled } })} /></label>
      <label className="flex min-w-0 items-center gap-3"><span className="min-w-0 flex-1">{t('tools:features.queryRewrite')}</span>
        <Switch aria-label={t('tools:features.queryRewrite')} checked={settings.memoryMaintenance?.queryRewrite ?? false} onCheckedChange={queryRewrite => setSettings({ ...settings, memoryMaintenance: { ...settings.memoryMaintenance, queryRewrite } })} /></label>
      <p className="text-xs text-muted-foreground">{t('tools:features.maintenanceDescription')}</p>
      <label className="flex min-w-0 items-center gap-3"><span className="min-w-0 flex-1">{t('tools:features.backgroundReview')}</span>
        <Switch aria-label={t('tools:features.backgroundReview')} checked={settings.memoryMaintenance?.backgroundReview ?? false} onCheckedChange={backgroundReview => setSettings({ ...settings, memoryMaintenance: { ...settings.memoryMaintenance, backgroundReview } })} /></label>
      <p className="text-xs text-muted-foreground">{t('tools:features.reviewDescription')}</p>
      <BackgroundReviewHistory />
      <Button className="self-start" disabled={busy} onClick={() => {
        setBusy(true); setError('')
        void call('set', settings).then(setSettings).catch(cause => setError(String(cause))).finally(() => setBusy(false))
      }}>{t('tools:features.save')}</Button>
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive break-words">{error}</p>}
  </details>
}
