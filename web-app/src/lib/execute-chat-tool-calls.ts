import { compactSearchOutput } from './compact-search-output'
import { personalTaskInput } from './personal-task-context'
import type { UIMessage } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'

/** Preserve non-enumerable Error.message instead of serializing errors as {}. */
export function toolErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) || 'Unknown tool error' }
  catch { return 'Tool failed with an unreadable error' }
}

export type ChatToolCall = {
  toolCallId: string
  toolName: string
  input: object
}

export type ChatToolOutput =
  | {
      tool: string
      toolCallId: string
      output: unknown
    }
  | {
      state: 'output-error'
      tool: string
      toolCallId: string
      errorText: string
    }

type ToolResult = {
  content?: unknown
  error?: unknown
}

type ExecuteChatToolCallsOptions = {
  toolCalls: readonly ChatToolCall[]
  signal: AbortSignal
  threadId: string
  ragToolNames: ReadonlySet<string>
  mcpToolNames: ReadonlySet<string>
  /**
   * `run_command` / `run_script` while chat offers them. Checked first: the
   * built-in tools win a name clash with an MCP tool.
   */
  execToolNames?: ReadonlySet<string>
  isAvailable?: (toolName: string) => Promise<boolean>
  approve: (
    toolName: string,
    threadId: string,
    input: object
  ) => Promise<boolean>
  callRagTool: (args: {
    toolName: string
    arguments: object
    threadId: string
    projectId?: string
    scope: 'project' | 'thread'
  }) => Promise<ToolResult>
  /** `threadId` lets the backend refuse servers a secure project does not allow. */
  callMcpTool: (args: {
    toolName: string
    arguments: object
    threadId: string
  }) => Promise<ToolResult>
  /** Runs an approved command/script; stops it when `signal` aborts. */
  callExecTool?: (args: {
    toolCallId: string
    toolName: string
    input: object
    threadId: string
    signal: AbortSignal
  }) => Promise<{ output: unknown } | { error: string }>
  getProjectId: () => string | undefined
  processOutput: (content: unknown) => Promise<unknown>
  addToolOutput: (output: ChatToolOutput) => void
  onError?: (error: unknown) => void
}

export async function executeChatToolCalls({
  toolCalls,
  signal,
  threadId,
  ragToolNames,
  mcpToolNames,
  execToolNames = new Set(),
  approve,
  isAvailable,
  callRagTool,
  callMcpTool,
  callExecTool,
  getProjectId,
  processOutput,
  addToolOutput,
  onError = (error) => console.error('Tool call error:', error),
}: ExecuteChatToolCallsOptions): Promise<void> {
  for (const toolCall of toolCalls) {
    if (signal.aborted) break

    try {
      const approved = await approve(
        toolCall.toolName,
        threadId,
        toolCall.input
      )

      if (!approved) {
        addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: 'Tool execution denied by user',
        })
        continue
      }

      // Recheck after approval: a connector can be disabled while it is open.
      if (isAvailable && !(await isAvailable(toolCall.toolName))) {
        addToolOutput({ state: 'output-error', tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId, errorText: 'Tool is no longer available for this chat' })
        continue
      }
      if (execToolNames.has(toolCall.toolName) && callExecTool) {
        const run = await callExecTool({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          threadId,
          signal,
        })
        addToolOutput(
          'error' in run
            ? {
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${run.error}`,
              }
            : {
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                output: run.output,
              }
        )
        continue
      }

      let result: ToolResult
      if (ragToolNames.has(toolCall.toolName)) {
        const projectId = getProjectId()
        result = await callRagTool({
          toolName: toolCall.toolName,
          arguments: toolCall.input,
          threadId,
          projectId,
          scope: projectId ? 'project' : 'thread',
        })
      } else if (mcpToolNames.has(toolCall.toolName)) {
        result = await callMcpTool({
          toolName: toolCall.toolName,
          arguments: personalTaskInput(toolCall.toolName, threadId, toolCall.input),
          threadId,
        })
      } else {
        result = {
          error: `Tool '${toolCall.toolName}' not found in any service`,
        }
      }

      // Source-native guards return a proposal rather than opening UI. Keep
      // ownership here: inspect the immutable proposal in approve(), await a
      // fresh human decision, then confirm without relying on another model turn.
      const reviewed = new Set<string>()
      while (toolCall.toolName === 'personal_native' && !result.error) {
        const content = result.content
        let proposal: { status?: string; pendingId?: string } | undefined
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part?.type !== 'text' || typeof part.text !== 'string') continue
            try {
              const parsed = JSON.parse(part.text)
              if (parsed?.status === 'approval_required') proposal = parsed
            } catch { /* Ordinary tool text is not an approval proposal. */ }
          }
        }
        if (!proposal) break
        const pendingId = proposal.pendingId
        if (!pendingId || reviewed.has(pendingId) || reviewed.size >= 8) {
          result = { error: 'Native approval did not produce a fresh bounded proposal' }
          break
        }
        reviewed.add(pendingId)
        const confirmation = { action: 'confirm', pendingId }
        const allowed = await approve(toolCall.toolName, threadId, confirmation)
        if (signal.aborted) break
        if (!allowed) { result = { error: 'Native action denied or approval proposal expired' }; break }
        if (isAvailable && !(await isAvailable(toolCall.toolName))) {
          result = { error: 'Tool is no longer available for this chat' }; break
        }
        result = await callMcpTool({ toolName: toolCall.toolName, arguments: confirmation, threadId })
      }
      if (signal.aborted) break

      if (result.error) {
        addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: `Error: ${toolErrorMessage(result.error)}`,
        })
      } else {
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: await processOutput(compactSearchOutput(toolCall.toolName, result.content)),
        })
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        onError(error)
        addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: `Error: ${toolErrorMessage(error)}`,
        })
      }
    }
  }
}

/**
 * True when the message still contains tool calls waiting on their results,
 * i.e. the turn will continue once they resolve. Tool parts with a delivered
 * output (`output-available` / `output-error`) count as resolved — a final
 * answer that follows answered tool calls is still terminal.
 */
export function hasUnresolvedToolCallParts(message: UIMessage): boolean {
  return message.parts.some((part) => {
    const isToolPart =
      part.type.startsWith('tool-') || part.type === 'dynamic-tool'
    if (!isToolPart) return false
    const state = (part as { state?: string }).state
    return state !== 'output-available' && state !== 'output-error'
  })
}

export function shouldSendToolFollowUp(
  messages: UIMessage[],
  controller: AbortController | null
): boolean {
  if (!controller || controller.signal.aborted) return false
  return lastAssistantMessageIsCompleteWithToolCalls({ messages })
}
