import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useToolApproval } from '@/hooks/useToolApproval'
import { offeredChatExecToolNames } from '@/lib/chat-exec-tools'
import { toolPermissionTarget, type ToolPermissionTarget } from '@/lib/tool-permission-targets'
import { useTranslation } from '@/i18n/react-i18next-compat'

export default function ToolPermissionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const tools = useAppState(state => state.tools)
  const servers = useMCPServers(state => state.mcpServers)
  const { persistentTools, setPersistentTool, removePersistentTool } = useToolApproval()
  const [targets, setTargets] = useState<ToolPermissionTarget[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setFailed(false)
    const names = [...new Set([...tools.map(tool => tool.name), ...offeredChatExecToolNames()])]
    void Promise.all(names.map(toolPermissionTarget)).then(values => {
      if (active) setTargets(values.filter((value): value is ToolPermissionTarget => !!value))
    }).catch(() => { if (active) { setTargets([]); setFailed(true) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, tools, servers])
  const rows = new Map(targets.map(target => [target.key, { target, available: true }]))
  for (const target of Object.values(persistentTools)) if (!rows.has(target.key)) rows.set(target.key, { target, available: false })
  const needle = query.trim().toLocaleLowerCase()
  const visible = [...rows.values()].filter(({ target }) => `${target.toolName} ${target.source}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.target.source.localeCompare(b.target.source) || a.target.toolName.localeCompare(b.target.toolName))
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg lg:max-w-lg xl:max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t('tools:permissions.title')}</DialogTitle>
        <DialogDescription>{t('tools:permissions.description')}</DialogDescription>
      </DialogHeader>
      <Input aria-label={t('tools:permissions.search')} placeholder={t('tools:permissions.search')} value={query} onChange={event => setQuery(event.target.value)} />
      {loading && <p role="status" className="text-sm text-muted-foreground">{t('tools:permissions.loading')}</p>}
      {failed && <p role="alert" className="text-sm">{t('tools:permissions.failed')}</p>}
      {!loading && !visible.length && <p className="text-sm text-muted-foreground">{t('tools:permissions.empty')}</p>}
      <div className="min-w-0 space-y-2">
        {visible.map(({ target, available }) => <div key={target.key} className="min-w-0 flex items-center gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1 break-words">
            <p className="text-sm font-medium break-all">{target.toolName}</p>
            <p className="text-xs text-muted-foreground break-all">{target.source}</p>
            {!available && <p className="text-xs text-muted-foreground">{t('tools:permissions.unavailable')}</p>}
          </div>
          {available ? <Switch aria-label={t('tools:permissions.allow', { tool: target.toolName, source: target.source })}
            checked={persistentTools[target.key]?.enabled ?? false} onCheckedChange={enabled => setPersistentTool(target, enabled)} />
            : <Button size="sm" variant="outline" onClick={() => removePersistentTool(target.key)}>{t('tools:permissions.remove')}</Button>}
        </div>)}
      </div>
    </DialogContent>
  </Dialog>
}
