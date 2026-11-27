import { memo } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { toNumber } from '@/utils/number'
import { Gauge, WholeWord } from 'lucide-react'

interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface TokenSpeed {
  tokenSpeed: number
  tokenCount?: number
  durationMs?: number
  // Speculative decoding stats (llama.cpp draft model: n_drafted / n_accepted).
  draftTokensTotal?: number
  draftTokensAccepted?: number
}

export interface InputTokenStats {
  messageId: string
  tokens?: number
  tokensPerSecond?: number
}

interface TokenSpeedIndicatorProps {
  inputStats?: InputTokenStats
  metadata?: Record<string, unknown>
  streaming?: boolean
}

export const TokenSpeedIndicator = memo(
  ({ metadata, streaming, inputStats }: TokenSpeedIndicatorProps) => {
    // Get real-time token speed from global state during streaming
    const streamingTokenSpeed = useAppState((state) =>
      state.tokenSpeed ? Math.round(state.tokenSpeed.tokenSpeed) : 0
    )
    const streamingTokenCount = useAppState((state) =>
      state.tokenSpeed?.tokenCount || 0
    )

    // Fallback to persisted metadata when not streaming
    const persistedTokenSpeed =
      (metadata?.tokenSpeed as TokenSpeed)?.tokenSpeed || 0
    const persistedTokenCount =
      (metadata?.tokenSpeed as TokenSpeed)?.tokenCount || 0
    const usage = metadata?.usage as TokenUsage | undefined

    const nonStreamingAssistantParam =
      typeof metadata?.assistant === 'object' &&
      metadata?.assistant !== null &&
      'parameters' in metadata.assistant
        ? (metadata.assistant as { parameters?: { stream?: boolean } })
            .parameters?.stream === false
        : undefined

    if (nonStreamingAssistantParam) return

    // Use streaming data if available, otherwise fall back to metadata
    const displaySpeed = inputStats ? Math.round(inputStats.tokensPerSecond ?? 0) : streaming
      ? streamingTokenSpeed
      : Math.round(toNumber(persistedTokenSpeed))

    const displayTokenCount = inputStats ? (inputStats.tokens ?? 0) : streaming
      ? streamingTokenCount
      : (usage?.outputTokens ?? persistedTokenCount)

    // Show indicator during streaming OR when we have persisted data
    const shouldShow = streaming || displaySpeed > 0 || displayTokenCount > 0

    if (!shouldShow) return

    // Speculative-decoding acceptance rate = accepted / total drafted tokens.
    const spec = metadata?.tokenSpeed as TokenSpeed | undefined
    const draftTotal = spec?.draftTokensTotal ?? 0
    const draftAccepted = spec?.draftTokensAccepted ?? 0
    const acceptanceRate =
      draftTotal > 0 ? (draftAccepted / draftTotal) * 100 : null

    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {displaySpeed > 0 && (
          <div className="flex items-center gap-1" title={inputStats ? "Prompt processing speed" : undefined}>
            <Gauge size={16} />
            <span>{displaySpeed} tok/sec</span>
          </div>
        )}
        {displayTokenCount > 0 && (
          <div className="flex items-center gap-1" title={inputStats ? "Input tokens, including conversation context" : undefined}>
            <WholeWord size={16} />
            <span>{displayTokenCount} tokens</span>
          </div>
        )}
        {acceptanceRate !== null && (
          <span>{acceptanceRate.toFixed(1)}% draft tokens accepted</span>
        )}
      </div>
    )
  }
)

export default memo(TokenSpeedIndicator)
