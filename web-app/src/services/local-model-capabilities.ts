import { controlDstar } from './dstar'
import { fetchDstarContext } from '@/lib/dstar-context-archive'
import { localEngineTarget, type LocalEngine } from './managed-local-engine'

type Provider = Pick<ModelProvider, 'provider' | 'base_url' | 'active' | 'models'>
export type SummaryQualifiedEnvelope = {
  protocol: 3
  coldStart: true
  maxMainTokens: number
  maxSnapshotBytes: number
  maxProtectedBytes: number
  scratchReserveBytes: 1073741824
}
export type SummaryPriorityScheduler = {
  policy: 'weighted-quanta-v1'
  foregroundWeight: number
  summaryWeight: 1
  computeSerialized: true
  activeLane: null | 'summary' | 'foreground'
  foregroundTurns: number
  summaryTurns: number
  recoveryRequired: false
}
export type SummaryStateBank = {
  context: 16384
  maxStateBytes: number
  sharedWeights: true
  serializedCompute: true
  experimental: true
} & ({ coldStart: false; requiresForegroundWarmup: true } | {
  coldStart: true; requiresForegroundWarmup: false; resourcePreparation: 'native-on-admission-v1'
}) & ({ protocol: 4 } | {
  protocol: 5
  continuationTextOnly: false
  foregroundPreparation: 'legacy-first-token-v1'
  foregroundPrefillExclusive: true
  scheduler: SummaryPriorityScheduler
})
export type LocalModelCapabilities = {
  engine: LocalEngine
  contextLength?: number
  runtimeId?: string
  usageScope?: string
  runtimeScope?: string
  archiveScope?: string
  summarySlot: boolean
  summaryClone?: boolean
  summaryStreamProgress?: boolean
  summaryTokenCounting: boolean
  summaryContext: number
  summaryQualifiedEnvelope?: SummaryQualifiedEnvelope
  summaryStateBank?: SummaryStateBank
  summaryMaxMainTokens?: number
  toolPreamble: 3 | 4 | null
  completionReview: boolean
  toolPolicy: 'dstar-markers' | 'plain-system-v1' | null
}

/** Feature privileges require a registered loopback identity, not a model family. */
export function localCapabilityTarget(provider?: Provider, model?: Pick<Model, 'id'> | null) {
  if (!provider || provider.active === false || !model) return null
  // Dstar discovery historically supplies an empty model list. A matching live
  // /models row is still required below before any feature is enabled.
  const target = localEngineTarget(provider, model)
  if (target || provider.models.length) return target
  const discovery = localEngineTarget({ ...provider, models: [{ id: model.id } as Model] }, model)
  return discovery?.engine === 'dstar' ? discovery : null
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
const positiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

/** Protocol 3 includes proven pristine EMPTY and protected DISK transactions.
 * Older protocols cannot safely summarize a long chat immediately after restart.
 * Read the qualified bounds, never estimate snapshot sizes or available RAM.
 * The server remains authoritative for actual live tokens (including generated
 * output), state-file bytes, protected state and dynamic memory admission. */
function qualifiedSummaryEnvelope(
  body: Record<string, unknown>, contextLength?: number
): SummaryQualifiedEnvelope | undefined {
  if (body.atomic_summary_protocol !== 3 || body.atomic_summary_cold_start !== true ||
      body.atomic_summary_scratch_reserve_bytes !== 1073741824 ||
      !contextLength || contextLength < 16384) return undefined
  const envelope = record(body.atomic_summary_qualified_envelope)
  const keys = ['max_main_tokens', 'max_snapshot_bytes', 'max_protected_bytes']
  if (Object.keys(envelope).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(envelope, key))) return undefined
  const maxMainTokens = positiveInteger(envelope.max_main_tokens)
  const maxSnapshotBytes = positiveInteger(envelope.max_snapshot_bytes)
  const maxProtectedBytes = positiveInteger(envelope.max_protected_bytes)
  if (!maxMainTokens || maxMainTokens > 2147483647 || maxMainTokens > contextLength ||
      !maxSnapshotBytes || !maxProtectedBytes) return undefined
  return { protocol: 3, coldStart: true, maxMainTokens, maxSnapshotBytes, maxProtectedBytes, scratchReserveBytes: 1073741824 }
}

/** Scheduler counters are an observation, not a progress/ETA or a pause event.
 * Refuse unsupported scheduling and recovery states instead of treating any
 * shared-weights advertisement as permission to run a summary. */
function summaryPriorityScheduler(value: unknown): SummaryPriorityScheduler | undefined {
  const scheduler = record(value)
  const foregroundWeight = positiveInteger(scheduler.foreground_weight)
  const validTurns = (turns: unknown): turns is number =>
    typeof turns === 'number' && Number.isSafeInteger(turns) && turns >= 0
  if (scheduler.policy !== 'weighted-quanta-v1' || !foregroundWeight || foregroundWeight > 64 ||
      scheduler.summary_weight !== 1 || scheduler.compute_serialized !== true ||
      (scheduler.active_lane !== null && scheduler.active_lane !== 'summary' && scheduler.active_lane !== 'foreground') ||
      !validTurns(scheduler.foreground_turns) || !validTurns(scheduler.summary_turns) ||
      scheduler.recovery_required !== false) return undefined
  return { policy: 'weighted-quanta-v1', foregroundWeight, summaryWeight: 1,
    computeSerialized: true, activeLane: scheduler.active_lane,
    foregroundTurns: scheduler.foreground_turns, summaryTurns: scheduler.summary_turns, recoveryRequired: false }
}

/** A separate mutable-state bank is a different contract, not an enlarged disk
 * qualification envelope. Native allocation/pressure admission is authoritative.
 * Experimental provenance is explicit; discovery is not live-model validation. */
function summaryStateBank(
  body: Record<string, unknown>, contextLength?: number
): SummaryStateBank | undefined {
  const maxStateBytes = positiveInteger(body.atomic_summary_state_bank_max_bytes)
  const protocol = body.atomic_summary_protocol
  const priority = protocol === 5
  const scheduler = priority ? summaryPriorityScheduler(body.atomic_summary_scheduler) : undefined
  // Cold support is an explicit native resource-preparation contract. The
  // legacy state-bank protocol still requires foreground warm-up.
  const cold = body.atomic_summary_cold_start === true &&
    body.atomic_summary_requires_foreground_warmup === false &&
    body.atomic_summary_resource_preparation === 'native-on-admission-v1'
  const warm = body.atomic_summary_cold_start === false &&
    body.atomic_summary_requires_foreground_warmup === true
  if ((protocol !== 4 && protocol !== 5) || (!cold && !warm) ||
      body.atomic_summary_isolation !== (priority ? 'shared-weights-priority-v1' : 'shared-weights-state-bank-v1') ||
      body.atomic_summary_context !== 16384 ||
      body.atomic_summary_shared_weights !== true || body.atomic_summary_serialized_compute !== true ||
      body.atomic_summary_experimental !== true ||
      body.atomic_summary_state_bank_provenance !== 'experimental-user-validation' ||
      body.atomic_summary_qualified_envelope !== null || !maxStateBytes ||
      !contextLength || contextLength < 16384) return undefined
  const preparation = cold
    ? { coldStart: true, requiresForegroundWarmup: false, resourcePreparation: 'native-on-admission-v1' } as const
    : { coldStart: false, requiresForegroundWarmup: true } as const
  const common = { context: 16384, ...preparation,
    maxStateBytes, sharedWeights: true, serializedCompute: true, experimental: true } as const
  if (protocol === 4) return { protocol: 4, ...common }
  if (!scheduler || body.atomic_summary_continuation_text_only !== false ||
      body.atomic_summary_foreground_preparation !== 'legacy-first-token-v1' ||
      body.atomic_summary_foreground_prefill_exclusive !== true) return undefined
  return { protocol: 5, ...common, continuationTextOnly: false,
    foregroundPreparation: 'legacy-first-token-v1', foregroundPrefillExclusive: true, scheduler }
}

/** Fresh observations only. Never cache a capacity across model/server restarts. */
export async function probeLocalModelCapabilities(
  provider: Provider,
  model: Pick<Model, 'id'>,
  options: { signal?: AbortSignal; completionReviewEnabled?: boolean } = {}
): Promise<LocalModelCapabilities | null> {
  const target = localCapabilityTarget(provider, model)
  if (!target) return null
  try {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)])
      : AbortSignal.timeout(3000)
    const response = await fetchDstarContext(`${provider.base_url!.replace(/\/$/, '')}/models`, { signal })
    if (!response.ok) return null
    const body = record(await response.json())
    const row = Array.isArray(body.data)
      ? body.data.map(record).find(entry => entry.id === model.id) : undefined
    if (!row) return null
    const runtimeId = typeof body.runtime_id === 'string' && body.runtime_id.length > 0
      ? body.runtime_id : undefined
    let fingerprint = typeof body.atomic_model_fingerprint === 'string' && body.atomic_model_fingerprint.length > 0
      ? body.atomic_model_fingerprint : undefined
    const summaryContext = positiveInteger(body.atomic_summary_context) ?? 0
    const contextLength = positiveInteger(row.context_length)
    if (target.engine === 'dstar' && !fingerprint) {
      try {
        const native = await controlDstar('status')
        if (native?.owned && native.status === 'ready') {
          // The native owner knows the quant behind Dstar's stable API aliases.
          // Contradictory observations must not produce a verified identity.
          if (!native.servedModels.includes(model.id) || !contextLength ||
              native.selection.context !== contextLength || !native.selection.model) return null
          fingerprint = JSON.stringify(['dstar-selection-v1', native.selection.model, contextLength])
        }
      } catch { /* Older/non-native clients retain explicitly legacy semantics. */ }
    }
    if (signal.aborted) return null
    const summaryQualifiedEnvelope = target.engine === 'strata'
      ? qualifiedSummaryEnvelope(body, contextLength) : undefined
    const stateBank = target.engine === 'strata' ? summaryStateBank(body, contextLength) : undefined
    const strataSummarySupported = summaryContext === 16384 && Boolean(runtimeId) && Boolean(fingerprint) &&
      body.atomic_summary_token_count === true &&
      ((Boolean(summaryQualifiedEnvelope) && body.atomic_summary_isolation === 'serial-snapshot-v1') || Boolean(stateBank))
    const summarySlot = body.atomic_summary_slot === true &&
      (target.engine === 'dstar' || strataSummarySupported)
    return {
      engine: target.engine, contextLength, runtimeId,
      // Historical request measurements survive a same-config restart. Live
      // occupancy is separately bound to the ephemeral server process.
      usageScope: fingerprint || target.engine === 'dstar'
        ? JSON.stringify([provider.provider, provider.base_url!.replace(/\/$/, ''), model.id, fingerprint ?? 'legacy-dstar'])
        : undefined,
      runtimeScope: runtimeId
        ? JSON.stringify([provider.provider, provider.base_url!.replace(/\/$/, ''), model.id, runtimeId])
        : undefined,
      archiveScope: fingerprint
        ? JSON.stringify([provider.provider, provider.base_url!.replace(/\/$/, ''), model.id, fingerprint])
        : undefined,
      summarySlot,
      // Both engines implement the same owner-bound clone wire contract. Dstar
      // must explicitly advertise it; legacy 16K servers remain unchanged.
      ...(summarySlot && body.atomic_summary_clone === true && runtimeId && fingerprint &&
        summaryContext === 16384 && body.atomic_summary_token_count === true ? { summaryClone: true } : {}),
      summaryStreamProgress: summarySlot && (target.engine === 'dstar' || body.atomic_summary_stream_progress === true),
      summaryTokenCounting: summarySlot && summaryContext === 16384 && body.atomic_summary_token_count === true,
      summaryContext,
      summaryQualifiedEnvelope,
      summaryStateBank: stateBank,
      summaryMaxMainTokens: summarySlot ? summaryQualifiedEnvelope?.maxMainTokens : undefined,
      toolPreamble: body.atomic_tool_preamble === 4 ? 4 : body.atomic_tool_preamble === 3 ? 3 : null,
      // Explicit opt-in is not semantic qualification: the experimental
      // classifier can mistake a conditional offer for unfinished work.
      // Strata's new capability names transport support separately from the
      // legacy qualification flag. Never infer it from summary support alone.
      completionReview: options.completionReviewEnabled === true && (
        target.engine === 'dstar'
          ? body.atomic_completion_review === true
          : summarySlot && Boolean(stateBank) && body.atomic_completion_review_experimental === true
      ),
      toolPolicy: target.engine === 'dstar'
        ? (body.atomic_tool_preamble === 3 || body.atomic_tool_preamble === 4 ? 'dstar-markers' : null)
        : body.atomic_tool_policy === 'plain-system-v1' ? 'plain-system-v1' : null,
    }
  } catch { return null }
}
