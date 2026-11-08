import { stripChatSpeechStyles } from '@/lib/audio/chatSpeechStyle'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { useToolApproval } from '@/hooks/useToolApproval'
import { isPersonalBuild } from '@/lib/personal-build'

const desktopTools: Record<string, string> = {
  personal_browser: 'Browser control',
  personal_windows: 'Window control',
  personal_native: 'Desktop control',
}

function desktopAction(name: string, input: unknown): string | undefined {
  if (name !== 'personal_native') return desktopTools[name]
  if (!input || typeof input !== 'object') return
  return Object.values(input).some(
    value => typeof value === 'string' && /^os\.(screen|window|app)\./.test(value)
  ) ? desktopTools[name] : undefined
}

export function useDesktopControlOverlay(
  threadId: string,
  messages: readonly UIMessage[],
  status: string
) {
  const latest = useRef({ messages, status })
  useEffect(() => {
    latest.current = { messages, status }
  }, [messages, status])

  useEffect(() => {
    if (!IS_TAURI || !isPersonalBuild() || !/Mac/.test(navigator.platform)) return

    let previous = ''
    let pending: { id: string; approval: NonNullable<ReturnType<typeof useToolApproval.getState>['modalProps']> } | undefined
    let disposed = false
    const unlisten = listen<{ id: string; decision: string }>('desktop-overlay-decision', ({ payload }) => {
      const current = useToolApproval.getState()
      if (disposed || !pending || payload.id !== pending.id ||
        !current.isModalOpen || current.modalProps !== pending.approval) return
      const approval = pending.approval
      if (payload.decision !== 'approve' && payload.decision !== 'deny') return
      pending = undefined // Consume before resolving; repeated clicks cannot approve the next action.
      if (payload.decision === 'approve') approval.onApprove(true)
      else approval.onDeny()
      refresh()
    })
    function publish(title: string, detail: string, approvalId: string | null = null) {
      const key = JSON.stringify([title, detail, approvalId])
      if (key === previous) return
      previous = key
      void invoke('update_desktop_control_overlay', { title, detail, approvalId }).catch(error => {
        console.warn('[desktop overlay]', error)
      })
    }

    const refresh = () => {
      const { messages, status } = latest.current
      const approvalState = useToolApproval.getState()
      const approval = approvalState.isModalOpen ? approvalState.modalProps : null
      const waiting = approval?.threadId === threadId &&
        (desktopAction(approval.toolName, approval.toolParameters) || approval.toolName === 'personal_native')
      if (waiting && approval) {
        if (pending?.approval !== approval) pending = { id: crypto.randomUUID(), approval }
      } else pending = undefined
      const active = status === 'streaming' || status === 'submitted'
      const message = messages.at(-1)
      const parts = active && message?.role === 'assistant' ? message.parts : []
      const tool = parts.findLast(part =>
        isToolUIPart(part) && desktopAction(getToolName(part), part.input)
      )
      if ((!waiting && document.hasFocus()) || (!waiting && !tool)) {
        publish('', '')
        return
      }
      const title = waiting ? 'Approval required' :
        tool && isToolUIPart(tool)
          ? tool.state.startsWith('output-')
            ? 'Responding after desktop action'
            : desktopAction(getToolName(tool), tool.input) ?? ''
          : ''
      const detail = waiting && approval
        ? `${approval.toolName}\n${JSON.stringify(approval.toolParameters ?? {}, null, 2)}`
        : parts.flatMap(part => part.type === 'text' ? [stripChatSpeechStyles(part.text)] : [])
        .join(' ').trim().slice(-1200)
      publish(title, detail, pending?.id ?? null)
    }
    refresh()
    const unsubscribe = useToolApproval.subscribe(refresh)
    const timer = window.setInterval(refresh, 250)
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      pending = undefined
      unsubscribe()
      void unlisten.then(stop => stop()).catch(error => console.warn('[desktop overlay listener]', error))
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      publish('', '')
    }
  }, [threadId])
}
