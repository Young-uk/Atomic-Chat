import type { UIMessage } from 'ai'
import type { AgentRunSummary } from '@/types/agent'
import { TraceBlock } from './types'
import { presentTool } from './registry'

type ActivityTraceBlock = Extract<TraceBlock, { kind: 'activity' }>

/** Permission waits belong to the same turn as running tools and reasoning. */
export function isAgentTurnActive(status: AgentRunSummary['status']): boolean {
  return (
    status === 'running' ||
    status === 'awaiting_approval' ||
    status === 'awaiting_folder_access'
  )
}

/**
 * Whether an activity block has anything behind its header: tool calls (the
 * terminal `reply` / `finish` are the answer itself, not a step), agent loops,
 * or a run's error. Without any of those the header is all there is.
 */
export function activityHasDetails(
  block: Pick<ActivityTraceBlock, 'tools' | 'agentSummary'>
): boolean {
  const summary = block.agentSummary
  const summaryToolCount =
    summary?.tools.filter(({ tool }) => tool !== 'reply' && tool !== 'finish')
      .length ?? 0
  return (
    block.tools.length > 0 ||
    summaryToolCount > 0 ||
    (summary?.loops.length ?? 0) > 0 ||
    Boolean(summary?.error)
  )
}

/**
 * Projects a message's parts into render blocks. A message renders the parts
 * it actually has: whether reasoning was requested is decided per request
 * (see `custom-chat-transport.ts` and `buildAgentReasoningRequest`), never
 * here, so the transcript on screen does not move when the effort setting
 * changes.
 */
export function buildTraceBlocks(
  message: UIMessage,
  options: { ensureActivity?: boolean } = {}
): TraceBlock[] {
  const blocks: TraceBlock[] = []
  const metadata = message.metadata as
    | { agent_run?: AgentRunSummary; activityDurationMs?: number }
    | undefined
  const agentRun = metadata?.agent_run
  let activityCount = 0
  const isLive =
    options.ensureActivity ??
    (agentRun !== undefined && isAgentTurnActive(agentRun.status))

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i]
    const previous = blocks.at(-1)
    if (part.type === 'text') {
      if (part.text?.trim())
        blocks.push({
          kind: 'text',
          key: `${message.id}-${i}`,
          text: part.text,
        })
    } else if (part.type === 'reasoning') {
      if (!part.text?.trim()) continue
      const block = previous?.kind === 'reasoning' ? previous : undefined
      const item = { key: `${message.id}-${i}`, text: part.text }
      if (block) {
        block.items.push(item)
        block.streaming = part.state !== 'done'
      } else
        blocks.push({
          kind: 'reasoning',
          key: `${message.id}-reasoning-${i}`,
          streaming: part.state !== 'done',
          items: [item],
        })
    } else if (part.type === 'file') {
      const file = part as {
        url?: string
        mediaType?: string
        filename?: string
      }
      if (
        file.url &&
        (file.mediaType?.startsWith('image/') ||
          file.mediaType?.startsWith('audio/'))
      ) {
        blocks.push({
          kind: file.mediaType.startsWith('image/') ? 'file' : 'audio',
          key: `${message.id}-${i}`,
          url: file.url,
          mediaType: file.mediaType,
          filename: file.filename,
        })
      }
    } else if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
      const toolName = part.type.slice('tool-'.length)
      if (toolName === 'reply' || toolName === 'finish') continue
      const block: ActivityTraceBlock =
        previous?.kind === 'activity'
          ? previous
          : {
              kind: 'activity',
              key: activityCount++
                ? `${message.id}-activity-${i}`
                : `${message.id}-activity`,
              tools: [],
            }
      if (block !== previous) blocks.push(block)
      const state = 'state' in part ? part.state : 'output-available'
      const input = 'input' in part ? part.input : undefined
      const output = 'output' in part ? part.output : undefined
      const errorText =
        'errorText' in part
          ? part.errorText
          : 'error' in part
            ? String(part.error)
            : undefined
      block.tools.push({
        key: `${message.id}-${i}`,
        toolName,
        state,
        presentation: presentTool({
          toolName,
          input,
          output,
          errorText,
          state,
        }),
      })
    }
  }

  // Only adjacent parts form a group. A later remark/tool/thought closes the
  // earlier thinking phase without moving it above another step in the turn.
  blocks.forEach((block, index) => {
    if (block.kind === 'reasoning')
      block.streaming &&= index === blocks.length - 1
    if (block.kind === 'activity')
      block.active =
        isLive &&
        (index === blocks.length - 1 ||
          block.tools.some(
            (tool) =>
              tool.state === 'input-streaming' ||
              tool.state === 'input-available'
          ))
  })
  const activity = blocks.findLast((block) => block.kind === 'activity') as
    | ActivityTraceBlock
    | undefined
  if (activity) {
    // Turn-wide diagnostics belong once, not on every group of tool calls.
    activity.durationMs = agentRun?.duration_ms ?? metadata?.activityDurationMs
    activity.agentSummary = agentRun
  } else if (
    isLive ||
    activityHasDetails({ tools: [], agentSummary: agentRun })
  ) {
    // Keep the existing status fallback before an answer or after a thought.
    // A finished duration-only row adds no information and is omitted.
    blocks.splice(blocks[0]?.kind === 'reasoning' ? 1 : 0, 0, {
      kind: 'activity',
      key: `${message.id}-activity`,
      tools: [],
      active: isLive,
      durationMs: agentRun?.duration_ms ?? metadata?.activityDurationMs,
      agentSummary: agentRun,
    })
  }
  return blocks
}
