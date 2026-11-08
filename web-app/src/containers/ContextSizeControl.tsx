import { type ThreadMessage } from '@janhq/core'
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  formatContextSize,
  useModelContextLength,
} from '@/hooks/useModelContextLength'
import { useDstarContextLimit } from '@/hooks/useDstarContextLimit'
import { useTokensCount } from '@/hooks/useTokensCount'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import { useInferenceProgress } from '@/lib/inference-progress'

interface ContextSizeControlProps {
  threadId?: string
  messages?: ThreadMessage[]
  additionalTokens?: number
  uploadedFiles?: Array<{
    name: string
    type: string
    size: number
    base64: string
    dataUrl: string
  }>
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toString()
}

type LatestTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  averageCacheHitRate?: number
}

function getLatestTokenUsage(
  messages: ThreadMessage[],
  modelId?: string,
  providerId?: string,
  usageScope?: string,
  requireScope = false
): LatestTokenUsage {
  let latest: LatestTokenUsage | undefined
  let cacheHitRateSum = 0
  let measuredRequests = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue

    const metadata = message.metadata as Record<string, unknown> | undefined
    if (modelId && (metadata?.modelId !== modelId || !metadata?.usage)) continue
    if (providerId && metadata?.providerId && metadata.providerId !== providerId) continue
    if (requireScope && (!usageScope || metadata?.contextUsageScope !== usageScope || !metadata?.contextUsage)) continue
    if (usageScope && metadata?.contextUsageScope && metadata.contextUsageScope !== usageScope) continue
    if (['error', 'abort', 'cancelled'].includes(String(metadata?.finishReason))) continue
    const usage = (metadata?.contextUsage ?? metadata?.usage) as
      | {
          inputTokens?: unknown
          outputTokens?: unknown
          totalTokens?: unknown
          cachedInputTokens?: unknown
        }
      | undefined
    const tokenSpeed = metadata?.tokenSpeed as
      | { tokenCount?: unknown }
      | undefined
    const outputValue = usage?.outputTokens ?? tokenSpeed?.tokenCount
    const outputTokens =
      typeof outputValue === 'number' && Number.isFinite(outputValue)
        ? Math.max(0, outputValue)
        : 0
    const totalTokens =
      typeof usage?.totalTokens === 'number' &&
      Number.isFinite(usage.totalTokens)
        ? Math.max(0, usage.totalTokens)
        : 0
    const inputTokens =
      typeof usage?.inputTokens === 'number' &&
      Number.isFinite(usage.inputTokens)
        ? Math.max(0, usage.inputTokens)
        : Math.max(0, totalTokens - outputTokens)

    const cached = usage?.cachedInputTokens
    const cachedInputTokens = typeof usage?.inputTokens === 'number'
      && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens > 0
      && typeof cached === 'number' && Number.isSafeInteger(cached)
      && cached >= 0 && cached <= usage.inputTokens ? cached : undefined
    latest ??= {
      cachedInputTokens,
      inputTokens,
      outputTokens,
      totalTokens: Math.max(totalTokens, inputTokens + outputTokens),
    }
    if (!modelId) break
    if (cachedInputTokens !== undefined && inputTokens > 0) {
      cacheHitRateSum += cachedInputTokens / inputTokens
      measuredRequests++
    }
  }
  return {
    ...(latest ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    averageCacheHitRate: measuredRequests ? (cacheHitRateSum / measuredRequests) * 100 : undefined,
  }
}

export function ContextSizeControl({
  threadId,
  messages = [],
  additionalTokens = 0,
  uploadedFiles = [],
}: ContextSizeControlProps) {
  const tokenData = useTokensCount(messages, uploadedFiles)
  const dstar = useDstarContextLimit()
  const isManagedLocal = dstar.isManagedLocal ?? dstar.isDstar
  const maxTokens = isManagedLocal ? dstar.maxTokens : tokenData.maxTokens
  const latestUsage = getLatestTokenUsage(
    messages,
    isManagedLocal ? dstar.modelId : undefined,
    isManagedLocal ? dstar.providerId : undefined,
    isManagedLocal ? dstar.usageScope : undefined,
    dstar.requireUsageScope ?? dstar.isStrata
  )
  const currentUsage = useInferenceProgress(state => threadId ? state.contextByThread?.[threadId] : undefined)
  const progress = useInferenceProgress(state => threadId ? state.byThread[threadId] : undefined)
  const requireRuntimeScope = dstar.isStrata || Boolean(dstar.runtimeScope)
  const scopedProgress = (requireRuntimeScope && (!dstar.runtimeScope || progress?.runtimeScope !== dstar.runtimeScope))
    || (progress?.usageScope && progress.usageScope !== dstar.usageScope) ? undefined : progress
  const activeTokens = scopedProgress?.total === undefined ? undefined : scopedProgress.total + (scopedProgress.cache ?? 0)
  const current = currentUsage && (!currentUsage.modelId || currentUsage.modelId === dstar.modelId)
    && (!requireRuntimeScope || (dstar.runtimeScope && currentUsage.runtimeScope === dstar.runtimeScope))
    && (!currentUsage.usageScope || currentUsage.usageScope === dstar.usageScope)
    ? currentUsage : undefined
  const currentTokens = isManagedLocal ? activeTokens ?? current?.tokens : undefined
  const currentEstimate = activeTokens === undefined && current?.estimated
  const usageLabel = currentTokens !== undefined
    ? currentEstimate ? 'Estimated next request' : current?.outputTokens && activeTokens === undefined ? 'Latest request including output' : 'Current request input'
    : 'Last reported request'
  // A summary estimate can replace occupancy while the last request's cache
  // measurement still describes that completed request.
  const cachedInput = isManagedLocal ? latestUsage.cachedInputTokens : undefined
  const cacheHitRate = cachedInput !== undefined && latestUsage.inputTokens > 0
    ? (cachedInput / latestUsage.inputTokens) * 100
    : undefined
  const measuredTokens = tokenData.tokenCount + additionalTokens
  const totalTokens =
    !isManagedLocal && measuredTokens > 0
      ? measuredTokens
      : (currentTokens ?? latestUsage.totalTokens) + additionalTokens
  const completionTokens = currentTokens !== undefined ? Math.min(totalTokens, activeTokens === undefined ? current?.outputTokens ?? 0 : 0) : Math.min(totalTokens, latestUsage.outputTokens)
  const promptTokens = Math.max(0, totalTokens - completionTokens)
  const percentage = maxTokens ? (totalTokens / maxTokens) * 100 : 0
  const isOverLimit = percentage > 100
  const progressTone =
    percentage >= 90
      ? 'bg-destructive'
      : percentage >= 70
        ? 'bg-orange-500'
        : 'bg-emerald-500'
  const {
    available,
    contextSetting,
    draft: draftContext,
    setDraft: setDraftContext,
    commit: handleContextChange,
    sliderMin,
    sliderMax,
    sliderStep,
    fitAvailable,
    fitEnabled,
    setFit,
  } = useModelContextLength()
  const { t } = useTranslation()

  if ((!available || !contextSetting) && !isManagedLocal) return null

  const percentageLabel =
    maxTokens && (!isManagedLocal || totalTokens > 0)
      ? `${percentage.toFixed(1)}%`
      : '—'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-2 px-2 font-mono text-xs"
          aria-label={`Context usage: ${percentageLabel}`}
          title={`${percentageLabel} · ${isManagedLocal && totalTokens === 0 ? '—' : formatTokenCount(totalTokens)} / ${maxTokens ? formatTokenCount(maxTokens) : '—'} tokens${isManagedLocal ? ` · ${usageLabel}` : ''}`}
        >
          <span className={cn(isOverLimit && 'text-destructive')}>
            {percentageLabel}
          </span>
          <span className="relative size-4 shrink-0">
            <svg className="size-4 -rotate-90" viewBox="0 0 16 16">
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                className="text-muted-foreground"
              />
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 6}`}
                strokeDashoffset={`${2 * Math.PI * 6 * (1 - Math.min(percentage, 100) / 100)}`}
                className={cn(
                  'transition-all duration-500 ease-out',
                  isOverLimit ? 'stroke-destructive' : 'stroke-primary'
                )}
                style={{ transformOrigin: 'center' }}
              />
            </svg>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-96 max-w-[calc(100vw-2rem)] space-y-4 p-4"
        data-testid="context-size-popover"
      >
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span
              className={cn(
                'text-xl font-semibold tabular-nums',
                isOverLimit ? 'text-destructive' : 'text-primary'
              )}
            >
              {percentageLabel}
            </span>
            <span className="font-mono text-sm text-muted-foreground">
              {isManagedLocal && totalTokens === 0
                ? '—'
                : formatTokenCount(totalTokens)}{' '}
              / {maxTokens ? formatTokenCount(maxTokens) : '—'}
            </span>
          </div>
          <Progress
            aria-label="Context usage"
            value={Math.min(percentage, 100)}
            className="h-1.5 bg-muted"
            indicatorClassName={progressTone}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IconArrowUp className="size-3.5" stroke={1.75} />
              <span>Input</span>
            </span>
            <span className="font-mono text-foreground">
              {formatTokenCount(promptTokens)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IconArrowDown className="size-3.5" stroke={1.75} />
              <span>Output</span>
            </span>
            <span className="font-mono text-foreground">
              {formatTokenCount(completionTokens)}
            </span>
          </div>
        </div>
        {isManagedLocal && latestUsage.averageCacheHitRate !== undefined && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 text-muted-foreground">Average cache hit rate in this chat</span>
            <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-foreground">
              {latestUsage.averageCacheHitRate.toFixed(1)}%
            </span>
          </div>
        )}
        {cacheHitRate !== undefined && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 text-muted-foreground">Last request cache hit rate</span>
            <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-foreground">
              {cacheHitRate.toFixed(1)}% ({formatTokenCount(cachedInput ?? 0)} / {formatTokenCount(latestUsage.inputTokens)})
            </span>
          </div>
        )}
        {isManagedLocal && (
          <p className="text-sm text-muted-foreground">
            {currentTokens !== undefined
              ? currentEstimate
                ? 'Estimated next request. Reflects the compacted conversation; the server will confirm the actual input size.'
                : current?.outputTokens && activeTokens === undefined ? 'Latest request including output, reported by the server.' : 'Current request input reported by the server, including cached tokens.'
              : 'Last reported request, including its output. Updates after a response completes; pending input and the next summary may change usage.'}
          </p>
        )}
        {available && contextSetting && (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  {contextSetting.title}
                </div>
                <div className="font-mono text-sm tabular-nums">
                  {formatContextSize(draftContext)}
                </div>
              </div>
              {contextSetting.description && !fitEnabled && (
                <div className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {contextSetting.description}
                </div>
              )}
            </div>
            {fitAvailable && (
              <label className="flex items-start justify-between gap-4 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">
                    {t('assistants:contextSizeFit')}
                  </span>
                  <span
                    className="mt-0.5 block leading-snug text-muted-foreground"
                    data-testid="context-size-fit-description"
                  >
                    {fitEnabled
                      ? t('assistants:contextSizeFitOn')
                      : t('assistants:contextSizeFitHint')}
                  </span>
                </span>
                <Switch
                  className="mt-0.5 shrink-0"
                  aria-label={t('assistants:contextSizeFit')}
                  checked={fitEnabled}
                  onCheckedChange={setFit}
                />
              </label>
            )}
            {/* Under fit the slider is not ignored silently, as it was: it is
              disabled, and the number above it is the one the engine chose. */}
            <Slider
              aria-label={contextSetting.title}
              className="w-full"
              disabled={fitEnabled}
              value={[Math.min(Math.max(draftContext, sliderMin), sliderMax)]}
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              onValueChange={([value]) => setDraftContext(value)}
              onValueCommit={([value]) => handleContextChange(value)}
            />
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{formatContextSize(sliderMin)}</span>
              <span>{formatContextSize(sliderMax)}</span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
