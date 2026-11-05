import { useMCPServers } from '@/hooks/useMCPServers'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useToolApproval } from '@/hooks/useToolApproval'
import { offeredChatExecToolNames } from '@/lib/chat-exec-tools'
import { getServiceHub } from '@/hooks/useServiceHub'
import { toolPermissionTarget, storedActionPermissionTarget, type ToolPermissionTarget } from './tool-permission-targets'

/**
 * Whether MCP/RAG tool calls on this thread run without asking. One rule for
 * both engines (the agent's `auto_approve_mcp` and the chat pipeline's
 * approval modal):
 *
 * - The composer's approval select is authoritative once the user has picked
 *   a mode for the thread: explicit "skip" auto-approves, explicit "manual"
 *   prompts — even while the global "Allow all MCP permissions" switch is on.
 * - Until the user picks, the global switch keeps its historical meaning
 *   (default on), so untouched threads stay prompt-free.
 *
 * The agent's dangerous built-in tools (shell etc.) are NOT governed by this:
 * they gate on the approval mode alone, defaulting to manual.
 */
export function resolveMcpAutoApprove(threadId: string): boolean {
  const explicit = useAgentMode.getState().approvalModes[threadId]
  if (explicit) return explicit === 'skip'
  return useToolApproval.getState().allowAllMCPPermissions
}

/**
 * Whether chat's own `run_command` / `run_script` calls run without asking:
 * only on an explicit "skip" (Full access). Like the agent's shell they gate
 * on the approval mode alone — the global "Allow all MCP permissions" switch
 * never covers them.
 */
export function resolveExecAutoApprove(threadId: string): boolean {
  return useAgentMode.getState().approvalModes[threadId] === 'skip'
}

/** The chat pipeline's approval step for one tool call. */
export async function approveChatToolCall(
  toolName: string,
  threadId: string,
  input: object
): Promise<boolean> {
  // Confirmation previews come from the worker's immutable pending proposal,
  // never from model-authored text that could misdescribe the native action.
  const nativeConfirmation = toolName === 'personal_native' && (input as { action?: string }).action === 'confirm'
  let storedTarget: ToolPermissionTarget | undefined
  if (nativeConfirmation) {
    try {
      const pendingId = (input as { pendingId?: unknown }).pendingId
      if (typeof pendingId !== 'string') return false
      const result = await getServiceHub().mcp().callTool({
        serverName: 'atomic-personal-tools', toolName,
        arguments: { action: 'inspect', pendingId },
      })
      if (result.error || ('isError' in result && result.isError)) return false
      const text = result.content?.filter(part => 'text' in part)
        .map(part => (part as { text: string }).text).join('\n') ?? ''
      const proposal = JSON.parse(text)
      if (proposal.id !== pendingId || typeof proposal.name !== 'string' ||
          !proposal.request || !proposal.args || proposal.expiresAt <= Date.now()) return false
      if (!proposal.request.affectedResources?.some((resource: string) => resource.startsWith('screen-target:'))) {
        storedTarget = await storedActionPermissionTarget(proposal.name, proposal.args, proposal.request)
      }
      input = { action: 'confirm', pendingId, nativeTool: proposal.name,
        arguments: proposal.args, approval: proposal.request }
    } catch { return false }
  }
  // Personal desktop tools can manipulate windows, browser sessions and
  // persistent memory. The global MCP switch must not grant those rights.
  // A nested source-native proposal always needs its own human confirmation,
  // even if the surrounding conversation grants ordinary Full access calls.
  // A user-created exact inspected-action grant is the sole scoped exception.
  const autoApprove = nativeConfirmation ? false : (offeredChatExecToolNames().has(toolName) || toolName.startsWith('personal_'))
    ? resolveExecAutoApprove(threadId)
    : resolveMcpAutoApprove(threadId)
  const persistentTarget = storedTarget ?? (!autoApprove && !nativeConfirmation ? await toolPermissionTarget(toolName) : undefined)
  if (autoApprove) return true
  const approved = await useToolApproval.getState().showApprovalModal(toolName, threadId, input, {
        bypassGlobalAutoApprove: true,
        ...(persistentTarget ? { persistentTarget } : {}),
        ...(nativeConfirmation ? { requireFreshApproval: true } : {}),
      })
  // Configuration may change while the user reads the modal. A decision for
  // the old provider must never authorize a replacement under the same name.
  if (approved && persistentTarget && (await toolPermissionTarget(toolName))?.key !== (persistentTarget.providerKey ?? persistentTarget.key)) return false
  return approved
}

/** Agent IPC has a turn-wide MCP flag; keep it manual when desktop tools are connected. */
export function resolveAgentMcpAutoApprove(threadId: string): boolean {
  if (useMCPServers.getState().mcpServers['atomic-personal-tools']?.active) return resolveExecAutoApprove(threadId)
  return resolveMcpAutoApprove(threadId)
}

/** The browser Chat path owns stored-proposal previews and fresh approvals.
 * Do not expose that adapter (or host-only bookkeeping) to a second runner
 * until it implements the same per-action approval contract. Its built-in
 * file/Git tools keep their existing native approval path. */
export function agentDisabledMcpTools(disabled: string[]): string[] {
  return [...new Set([...disabled, ...['personal_native', 'personal_memory_lifecycle', 'personal_task_delivery', 'personal_feature_settings']
    .map(name => `atomic-personal-tools::${name}`)])]
}
