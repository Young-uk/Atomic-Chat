import { stripChatSpeechStyles } from '@/lib/audio/chatSpeechStyle'
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
    function publish(title: string, detail: string) {
      const key = JSON.stringify([title, detail])
      if (key === previous) return
      previous = key
      void invoke('update_desktop_control_overlay', { title, detail }).catch(error => {
        console.warn('[desktop overlay]', error)
      })
    }

    const refresh = () => {
      const { messages, status } = latest.current
      const approval = useToolApproval.getState().modalProps
      const waiting = approval?.threadId === threadId &&
        desktopAction(approval.toolName, approval.toolParameters)
      const active = status === 'streaming' || status === 'submitted'
      const message = messages.at(-1)
      const parts = active && message?.role === 'assistant' ? message.parts : []
      const tool = parts.findLast(part =>
        isToolUIPart(part) && desktopAction(getToolName(part), part.input)
      )
      if (document.hasFocus() || (!waiting && !tool)) {
        publish('', '')
        return
      }
      const title = waiting ? 'Approval required' :
        tool && isToolUIPart(tool)
          ? tool.state.startsWith('output-')
            ? 'Responding after desktop action'
            : desktopAction(getToolName(tool), tool.input) ?? ''
          : ''
      const detail = parts.flatMap(part => part.type === 'text' ? [stripChatSpeechStyles(part.text)] : [])
        .join(' ').trim().slice(-1200)
      publish(title, detail)
    }
    const timer = window.setInterval(refresh, 250)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      publish('', '')
    }
  }, [threadId])
}
