import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToolApproval } from '@/hooks/useToolApproval'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  chatExecLanguageName,
  DEFAULT_TIMEOUT_SECONDS,
  isChatExecTool,
  MAX_TIMEOUT_SECONDS,
  RUN_COMMAND_TOOL,
} from '@/lib/chat-exec-tools'
import { secureEnvironmentForThread } from '@/hooks/useSecureEnvironments'
import type { SecureEnvironment } from '@/services/chat-exec/types'

type ExecCall = {
  title: string
  source: string
  timeoutSeconds: number
}

/** A `run_command` / `run_script` call as the user should read it. */
function describeExecCall(
  toolName: string,
  parameters: object | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): ExecCall | null {
  if (!isChatExecTool(toolName)) return null
  const args = (parameters ?? {}) as Record<string, unknown>
  const source =
    toolName === RUN_COMMAND_TOOL ? args.command : (args.code as unknown)
  const timeout = args.timeout_seconds
  return {
    title:
      toolName === RUN_COMMAND_TOOL
        ? t('tools:toolApproval.exec.commandTitle')
        : t('tools:toolApproval.exec.scriptTitle', {
            language: chatExecLanguageName(args.language) ?? args.language,
          }),
    source: typeof source === 'string' ? source : '',
    timeoutSeconds:
      typeof timeout === 'number' && timeout > 0
        ? Math.min(Math.round(timeout), MAX_TIMEOUT_SECONDS)
        : DEFAULT_TIMEOUT_SECONDS,
  }
}

/** Descriptions come from known adapter operations, never a model-written
 * permission explanation. Unknown operations retain the raw parameter view. */
function describeNativeCall(toolName: string, parameters: object | undefined,
  t: (key: string, options?: Record<string, unknown>) => string) {
  if (toolName !== 'personal_native') return null
  const args = (parameters ?? {}) as Record<string, unknown>
  const action = args.action
  if (!['catalog', 'describe', 'inspect', 'run', 'confirm'].includes(String(action))) return null
  const target = action === 'confirm' ? args.nativeTool : action === 'inspect' ? args.pendingId : args.name
  return {
    title: t(`tools:toolApproval.native.${action}Title`),
    description: t(`tools:toolApproval.native.${action}Description`),
    target: typeof target === 'string' ? target : undefined,
  }
}

function sandboxNotice(
  secure: SecureEnvironment | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (secure) {
    // The backend refuses a secure project's command outside MXC, so there
    // is no "runs on the host" variant to word.
    const folders = secure.folders
      .map((folder) =>
        t(
          folder.canEdit
            ? 'tools:toolApproval.exec.secureFolderEditable'
            : 'tools:toolApproval.exec.secureFolderReadOnly',
          { path: folder.path }
        )
      )
      .join(', ')
    return [
      folders
        ? t('tools:toolApproval.exec.secure', { folders })
        : t('tools:toolApproval.exec.secureNoFolders'),
      secure.network ? '' : t('tools:toolApproval.exec.secureOffline'),
    ]
      .filter(Boolean)
      .join(' ')
  }
  // Every other chat runs its commands on the host.
  return t('tools:toolApproval.exec.unsandboxed')
}

export default function ToolApproval() {
  const { t } = useTranslation()
  const { isModalOpen, modalProps, setModalOpen } = useToolApproval()

  if (!modalProps) {
    return null
  }

  const { toolName, threadId, toolParameters, onApprove, onDeny, onAlwaysAllow, requireFreshApproval, permissionSource, storedActionPermission } = modalProps
  const exec = describeExecCall(toolName, toolParameters, t)
  const native = describeNativeCall(toolName, toolParameters, t)
  const secure = exec ? secureEnvironmentForThread(threadId) : undefined

  const handleAllowOnce = () => {
    onApprove(true) // true = allow once only
  }

  const handleAllow = () => {
    onApprove(false) // false = remember for this thread
  }

  const handleDeny = () => {
    onDeny()
  }

  const handleDialogOpen = (open: boolean) => {
    setModalOpen(open)
    if (!open) {
      onDeny()
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleDialogOpen}>
      <DialogContent
        onOpenAutoFocus={(event) => { if (!document.hasFocus()) event.preventDefault() }}
        onCloseAutoFocus={(event) => { if (!document.hasFocus()) event.preventDefault() }}
        className="sm:max-w-lg lg:max-w-lg xl:max-w-lg max-h-[90vh] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 text-muted-foreground">
              <AlertTriangle className="size-4" />
            </div>
            <div className="min-w-0 break-words">
              <DialogTitle>
                {exec ? exec.title : native ? native.title : t('tools:toolApproval.title')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-muted-foreground">
                {exec ? (
                  t('tools:toolApproval.exec.description')
                ) : native ? (
                  native.description
                ) : (
                  <>
                    {t('tools:toolApproval.description')}{' '}
                    <span className="font-semibold">{toolName}</span>.&nbsp;
                    <span className="text-sm">
                      {t('tools:toolApproval.permissionScope')}
                    </span>
                  </>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {native && (
          <div className="min-w-0 rounded-lg border p-3 text-sm break-words">
            {native.target && <p className="whitespace-pre-wrap break-all">
              <span className="font-medium">{t('tools:toolApproval.native.target')}: </span>{native.target}
            </p>}
            <p className="text-muted-foreground">{t(storedActionPermission ? 'tools:toolApproval.storedActionScope' : requireFreshApproval ? 'tools:toolApproval.freshOnly' : 'tools:toolApproval.permissionScope')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t(storedActionPermission ? 'tools:toolApproval.storedActionManage' : requireFreshApproval ? 'tools:toolApproval.freshOnly' : 'tools:toolApproval.native.threadScope')}
            </p>
          </div>
        )}

        {onAlwaysAllow && !requireFreshApproval && <p className="text-sm text-muted-foreground break-words">
          {t('tools:toolApproval.persistentScope', { source: permissionSource, tool: toolName })}
        </p>}

        {exec && (
          <pre
            data-testid="exec-approval-source"
            className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-secondary p-2 font-mono text-sm"
          >
            {exec.source}
          </pre>
        )}

        {!exec && toolParameters && Object.keys(toolParameters).length > 0 && (
          <div className="min-w-0 bg-background p-2 border rounded-lg">
            <h4 className="text-sm font-medium mb-2">
              {t('tools:toolApproval.parameters')}
            </h4>
            <div className="relative bg-secondary rounded-md p-2 text-sm font-mono border overflow-x-auto">
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(toolParameters, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <div className="p-2 border bg-secondary rounded-lg">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {exec
              ? `${sandboxNotice(secure, t)} ${t('tools:toolApproval.exec.timeout', { seconds: exec.timeoutSeconds })}`
              : t('tools:toolApproval.securityNotice')}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeny}
            className="flex-1 text-right sm:flex-none"
          >
            {t('tools:toolApproval.deny')}
          </Button>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-center">
            <Button variant="ghost" size="sm" onClick={handleAllowOnce}>
              {t('tools:toolApproval.allowOnce')}
            </Button>
            {!requireFreshApproval && <Button
              variant="default"
              size="sm"
              onClick={handleAllow}
              autoFocus={document.hasFocus()}
              className="capitalize"
            >
              {t('tools:toolApproval.alwaysAllow')}
            </Button>}
            {onAlwaysAllow && (!requireFreshApproval || storedActionPermission) && <Button size="sm" variant="outline" onClick={onAlwaysAllow}>
              {t('tools:toolApproval.allowAlways')}
            </Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
