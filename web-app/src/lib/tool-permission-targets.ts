import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
import { offeredChatExecToolNames } from './chat-exec-tools'

export type ToolPermissionTarget = { key: string; toolName: string; source: string }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}

/** Bind remembered access to the configured provider and schema, not just a
 * model-visible name. Persist only a digest: connector credentials stay private. */
export async function toolPermissionTarget(toolName: string): Promise<ToolPermissionTarget | undefined> {
  if (['personal_feature_settings', 'personal_memory_lifecycle', 'personal_task_delivery'].includes(toolName)) return undefined
  let source: string, identity: unknown
  if (offeredChatExecToolNames().has(toolName)) {
    source = 'Atomic Chat'
    identity = ['atomic-chat-exec-v1', toolName]
  } else {
    const candidates = useAppState.getState().tools.filter(tool => tool.name === toolName)
    if (candidates.length !== 1) return undefined
    const tool = candidates[0], config = useMCPServers.getState().mcpServers[tool.server]
    if (!config) return undefined
    source = tool.server
    identity = ['atomic-mcp-tool-v1', source, toolName, tool.inputSchema,
      { command: config.command, args: config.args, env: config.env, type: config.type,
        url: config.url, headers: config.headers, cwd: config.cwd }]
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(identity))))
  return { key: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), toolName, source }
}
