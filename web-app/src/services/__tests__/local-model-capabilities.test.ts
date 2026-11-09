import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localCapabilityTarget, probeLocalModelCapabilities } from '../local-model-capabilities'
import { STRATA_MODEL, STRATA_PROVIDER } from '../managed-local-engine'

const request = vi.hoisted(() => vi.fn())
const nativeStatus = vi.hoisted(() => vi.fn())
vi.mock('../dstar', () => ({ controlDstar: nativeStatus }))
vi.mock('@/lib/dstar-context-archive', () => ({ fetchDstarContext: request }))
const model = { id: STRATA_MODEL }
const provider = { provider: STRATA_PROVIDER, base_url: 'http://127.0.0.1:18080/v1', models: [model] } as ModelProvider
const envelope = { max_main_tokens: 8192, max_snapshot_bytes: 64 * 1024 ** 2, max_protected_bytes: 128 * 1024 ** 2 }
const capabilities = (extra = {}) => ({ data: [{ id: STRATA_MODEL, context_length: 65536 }], runtime_id: 'server-a', atomic_model_fingerprint: 'config-a',
  atomic_summary_slot: true, atomic_summary_context: 16384, atomic_summary_token_count: true,
  atomic_summary_protocol: 3, atomic_summary_cold_start: true, atomic_summary_scratch_reserve_bytes: 1073741824, atomic_summary_qualified_envelope: envelope,
  atomic_summary_isolation: 'serial-snapshot-v1', atomic_tool_policy: 'plain-system-v1', ...extra })
const respond = (body: unknown, ok = true) => request.mockResolvedValue({ ok, json: async () => body })
beforeEach(() => { request.mockReset(); nativeStatus.mockReset() })

describe('observed managed local capabilities', () => {
  it.each(['https://127.0.0.1:18080/v1', 'http://example.com:18080/v1', 'http://127.0.0.1:18080/other',
    'http://user:pass@127.0.0.1:18080/v1', 'http://127.0.0.1:18080/v1?proxy=1'])('rejects non-managed URL %s', async base_url => {
    expect(await probeLocalModelCapabilities({ ...provider, base_url }, model)).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
  it('requires registered provider and model, not family or port alone', async () => {
    expect(localCapabilityTarget({ ...provider, provider: 'other' }, model)).toBeNull()
    expect(localCapabilityTarget({ ...provider, models: [] }, model)).toBeNull()
    expect(localCapabilityTarget(provider, { id: 'qwen3.8-iq3' })).toBeNull()
    expect(localCapabilityTarget({ ...provider, active: false }, model)).toBeNull()
  })
  it('reads runtime capacity and individually negotiated capabilities', async () => {
    respond(capabilities())
    const value = await probeLocalModelCapabilities(provider, model)
    expect(value).toMatchObject({ engine: 'strata', contextLength: 65536, runtimeId: 'server-a', summarySlot: true,
      summaryTokenCounting: true, toolPreamble: null, completionReview: false, toolPolicy: 'plain-system-v1' })
    respond(capabilities({ runtime_id: 'server-b' }))
    expect((await probeLocalModelCapabilities(provider, model))?.runtimeScope).not.toBe(value?.runtimeScope)
  })
  it('replaces capacity and usage identities after restarting with a smaller context', async () => {
    respond(capabilities())
    const before = await probeLocalModelCapabilities(provider, model)
    respond(capabilities({ runtime_id: 'server-b', atomic_model_fingerprint: 'config-32768',
      data: [{ id: STRATA_MODEL, context_length: 32768 }] }))
    const after = await probeLocalModelCapabilities(provider, model)
    expect(after?.contextLength).toBe(32768)
    expect(after?.runtimeScope).not.toBe(before?.runtimeScope)
    expect(after?.usageScope).not.toBe(before?.usageScope)
    expect(after?.archiveScope).not.toBe(before?.archiveScope)
    expect(after?.summaryContext).toBe(16384)
  })
  it.each([
    { runtime_id: undefined }, { atomic_model_fingerprint: undefined }, { atomic_summary_isolation: undefined }, { atomic_summary_token_count: false },
    { atomic_summary_context: 8192 }, { atomic_summary_slot: false },
  ])('fails closed for incomplete Strata summary contract %j', async extra => {
    respond(capabilities(extra))
    expect((await probeLocalModelCapabilities(provider, model))?.summarySlot).toBe(false)
  })
  it.each([0, -1, 1.5, '65536', NaN])('never invents context for malformed limit %s', async context_length => {
    respond(capabilities({ data: [{ id: STRATA_MODEL, context_length }] }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ contextLength: undefined, summarySlot: false })
  })
  it('keeps archives stable across restarts but isolates changed model fingerprints', async () => {
    respond(capabilities({ atomic_model_fingerprint: 'model-a' }))
    const first = await probeLocalModelCapabilities(provider, model)
    respond(capabilities({ atomic_model_fingerprint: 'model-a', runtime_id: 'server-b' }))
    const restarted = await probeLocalModelCapabilities(provider, model)
    expect(restarted?.archiveScope).toBe(first?.archiveScope)
    expect(restarted?.usageScope).toBe(first?.usageScope)
    expect(restarted?.runtimeScope).not.toBe(first?.runtimeScope)
    respond(capabilities({ atomic_model_fingerprint: 'model-b' }))
    expect((await probeLocalModelCapabilities(provider, model))?.archiveScope).not.toBe(first?.archiveScope)
  })
  it('does not infer runtime identity for old Strata metadata', async () => {
    respond(capabilities({ runtime_id: undefined, atomic_model_fingerprint: undefined }))
    const value = await probeLocalModelCapabilities(provider, model)
    expect(value?.usageScope).toBeUndefined()
    expect(value?.runtimeScope).toBeUndefined()
  })
  it('rejects unmatched models, errors and offline probes', async () => {
    respond(capabilities({ data: [{ id: 'other', context_length: 65536 }] }))
    expect(await probeLocalModelCapabilities(provider, model)).toBeNull()
    respond(capabilities(), false)
    expect(await probeLocalModelCapabilities(provider, model)).toBeNull()
    request.mockRejectedValue(new Error('offline'))
    expect(await probeLocalModelCapabilities(provider, model)).toBeNull()
  })
  it('retains legacy Dstar discovery, summary fallback and marker version', async () => {
    respond({ data: [{ id: 'dstar-model', context_length: 131072 }], atomic_summary_slot: true, atomic_tool_preamble: 4 })
    const value = await probeLocalModelCapabilities({ provider: 'dstar', base_url: 'http://localhost:8010/v1', models: [] }, { id: 'dstar-model' })
    expect(value).toMatchObject({ engine: 'dstar', contextLength: 131072, summarySlot: true, summaryContext: 0,
      summaryTokenCounting: false, toolPreamble: 4, toolPolicy: 'dstar-markers' })
    expect(value?.usageScope).toContain('legacy-dstar')
  })
})


describe('verified Dstar quant identity', () => {
  const provider = { provider: 'dstar', base_url: 'http://localhost:8010/v1', models: [] }
  const model = { id: 'qwen-alias' }
  const native = (quant = 'iq3', context = 65536) => ({ owned: true, status: 'ready',
    servedModels: ['qwen-alias'], selection: { model: quant, context } })
  beforeEach(() => { respond({ data: [{ id: 'qwen-alias', context_length: 65536 }] }) })
  it('binds both API alias and native quant/context without process or file paths', async () => {
    nativeStatus.mockResolvedValue(native())
    const first = await probeLocalModelCapabilities(provider, model)
    const second = await probeLocalModelCapabilities(provider, model)
    expect(first?.usageScope).toBe(second?.usageScope)
    expect(first?.archiveScope).toBe(first?.usageScope)
    expect(first?.usageScope).toContain('iq3')
    nativeStatus.mockResolvedValue(native('iq2'))
    expect((await probeLocalModelCapabilities(provider, model))?.usageScope).not.toBe(first?.usageScope)
    expect(nativeStatus).toHaveBeenCalledWith('status')
  })
  it('fails closed when native capacity or served model contradicts the API', async () => {
    nativeStatus.mockResolvedValue(native('iq3', 131072))
    expect(await probeLocalModelCapabilities(provider, model)).toBeNull()
    nativeStatus.mockResolvedValue({ ...native(), servedModels: ['other'] })
    expect(await probeLocalModelCapabilities(provider, model)).toBeNull()
  })
  it('keeps ambiguous native identity explicitly legacy, never the verified IQ3 scope', async () => {
    nativeStatus.mockResolvedValue(native())
    const verified = await probeLocalModelCapabilities(provider, model)
    nativeStatus.mockResolvedValue({ ...native(), owned: false, status: 'external' })
    const legacy = await probeLocalModelCapabilities(provider, model)
    expect(legacy?.usageScope).toContain('legacy-dstar')
    expect(legacy?.usageScope).not.toBe(verified?.usageScope)
    expect(legacy?.archiveScope).toBeUndefined()
    nativeStatus.mockRejectedValue(new Error('native unavailable'))
    expect((await probeLocalModelCapabilities(provider, model))?.usageScope).toBe(legacy?.usageScope)
  })
})

it.each([false, true])('keeps release review disabled regardless of advertisement with summaries off: %s', async review => {
  respond(capabilities({ atomic_summary_slot: false, atomic_completion_review: review }))
  expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
    summarySlot: false, completionReview: false, toolPolicy: 'plain-system-v1',
  })
})


describe('Strata protocol 3 qualification envelope', () => {
  it('exposes qualified main-token scheduling bound separately from the actual 64K context', async () => {
    respond(capabilities())
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
      contextLength: 65536, summarySlot: true, summaryMaxMainTokens: 8192,
      summaryQualifiedEnvelope: { protocol: 3, coldStart: true, maxMainTokens: 8192, maxSnapshotBytes: 67108864,
        maxProtectedBytes: 134217728, scratchReserveBytes: 1073741824 },
    })
  })
  it.each([
    undefined, null, [], {}, { ...envelope, extra: 1 },
    { ...envelope, max_main_tokens: 0 }, { ...envelope, max_main_tokens: -1 },
    { ...envelope, max_main_tokens: 65537 }, { ...envelope, max_main_tokens: 2147483648 },
    { ...envelope, max_main_tokens: '8192' }, { ...envelope, max_snapshot_bytes: true },
    { ...envelope, max_snapshot_bytes: 1.5 }, { ...envelope, max_snapshot_bytes: Infinity },
    { ...envelope, max_snapshot_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...envelope, max_protected_bytes: 0 }, { ...envelope, max_protected_bytes: NaN },
    { max_main_tokens: 8192, max_snapshot_bytes: 67108864 },
  ])('rejects missing or malformed envelope %j for summary and independent review', async atomic_summary_qualified_envelope => {
    respond(capabilities({ atomic_summary_qualified_envelope, atomic_completion_review: true }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
      summarySlot: false, completionReview: false, summaryMaxMainTokens: undefined, summaryQualifiedEnvelope: undefined,
    })
  })
  it.each([
    { atomic_summary_protocol: undefined }, { atomic_summary_protocol: 1 }, { atomic_summary_protocol: 2 },
    { atomic_summary_protocol: '3' }, { atomic_summary_protocol: 4 },
    { atomic_summary_cold_start: undefined }, { atomic_summary_cold_start: false }, { atomic_summary_cold_start: 'true' },
    { atomic_summary_scratch_reserve_bytes: undefined }, { atomic_summary_scratch_reserve_bytes: 536870912 },
    { data: [{ id: STRATA_MODEL, context_length: 8192 }] },
  ])('requires the supported protocol and fixed scratch contract %j', async extra => {
    respond(capabilities({ ...extra, atomic_completion_review: true }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: false, completionReview: false,
      summaryMaxMainTokens: undefined, summaryQualifiedEnvelope: undefined })
  })
  it('does not fabricate a main bound when only backend review is advertised', async () => {
    respond(capabilities({ atomic_summary_slot: false, atomic_completion_review: true }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: false, completionReview: false,
      summaryMaxMainTokens: undefined, summaryQualifiedEnvelope: { maxMainTokens: 8192 } })
  })
  it('does not let legacy Dstar advertisement bypass the release review gate', async () => {
    respond({ data: [{ id: 'dstar-model', context_length: 65536 }], atomic_completion_review: true })
    expect(await probeLocalModelCapabilities({ provider: 'dstar', base_url: 'http://localhost:8010/v1', models: [] },
      { id: 'dstar-model' })).toMatchObject({ summarySlot: false, completionReview: false, summaryQualifiedEnvelope: undefined })
  })
})


describe('completion review release safety isolation', () => {
  it('retains qualified Strata summaries and visible tool policy while refusing advertised review', async () => {
    respond(capabilities({ atomic_completion_review: true }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
      completionReview: false, summarySlot: true, summaryTokenCounting: true,
      summaryMaxMainTokens: 8192, toolPolicy: 'plain-system-v1',
    })
  })
  it.each([3, 4])('retains Dstar summary/counting and preamble protocol %s without review', async atomic_tool_preamble => {
    respond({ data: [{ id: 'dstar-model', context_length: 65536 }],
      atomic_completion_review: true, atomic_summary_slot: true,
      atomic_summary_context: 16384, atomic_summary_token_count: true, atomic_tool_preamble })
    expect(await probeLocalModelCapabilities({ provider: 'dstar', base_url: 'http://localhost:8010/v1', models: [] },
      { id: 'dstar-model' })).toMatchObject({ completionReview: false, summarySlot: true,
      summaryTokenCounting: true, toolPreamble: atomic_tool_preamble, toolPolicy: 'dstar-markers' })
  })
})


describe('experimental separate Strata summary state bank', () => {
  const bank = (extra = {}) => capabilities({
    atomic_summary_protocol: 4, atomic_summary_isolation: 'shared-weights-state-bank-v1',
    atomic_summary_cold_start: false, atomic_summary_requires_foreground_warmup: true,
    atomic_summary_shared_weights: true, atomic_summary_serialized_compute: true,
    atomic_summary_experimental: true, atomic_summary_state_bank_provenance: 'experimental-user-validation',
    atomic_summary_state_bank_max_bytes: 1073741824, atomic_summary_qualified_envelope: null,
    ...extra,
  })
  it('negotiates a distinct unqualified state bank without the old 8K main bound', async () => {
    respond(bank({ atomic_completion_review: true }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
      contextLength: 65536, summarySlot: true, summaryTokenCounting: true, summaryContext: 16384,
      summaryQualifiedEnvelope: undefined, summaryMaxMainTokens: undefined, completionReview: false,
      summaryStateBank: { protocol: 4, context: 16384, coldStart: false, requiresForegroundWarmup: true,
        maxStateBytes: 1073741824, sharedWeights: true, serializedCompute: true, experimental: true },
    })
  })
  it.each([
    { atomic_summary_protocol: 3 }, { atomic_summary_protocol: '4' },
    { atomic_summary_isolation: 'serial-snapshot-v1' },
    { atomic_summary_cold_start: true }, { atomic_summary_cold_start: undefined },
    { atomic_summary_requires_foreground_warmup: false }, { atomic_summary_requires_foreground_warmup: undefined },
    { atomic_summary_shared_weights: false }, { atomic_summary_serialized_compute: false },
    { atomic_summary_experimental: false }, { atomic_summary_state_bank_provenance: undefined },
    { atomic_summary_state_bank_provenance: 'qualified' }, { atomic_summary_qualified_envelope: envelope },
    { atomic_summary_qualified_envelope: undefined }, { atomic_summary_state_bank_max_bytes: 0 },
    { atomic_summary_state_bank_max_bytes: -1 }, { atomic_summary_state_bank_max_bytes: '1073741824' },
    { atomic_summary_state_bank_max_bytes: 1.5 }, { atomic_summary_state_bank_max_bytes: Infinity },
    { atomic_summary_state_bank_max_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { atomic_summary_context: 8192 }, { atomic_summary_token_count: false }, { atomic_summary_slot: false },
    { data: [{ id: STRATA_MODEL, context_length: 8192 }] }, { runtime_id: undefined },
    { atomic_model_fingerprint: undefined },
  ])('does not infer state-bank support from incomplete or contradictory fields %j', async extra => {
    respond(bank(extra))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: false,
      summaryMaxMainTokens: undefined, summaryQualifiedEnvelope: undefined, completionReview: false })
  })
})


describe('experimental weighted Strata summary scheduling', () => {
  const scheduler = { policy: 'weighted-quanta-v1', foreground_weight: 8, summary_weight: 1,
    compute_serialized: true, active_lane: null, foreground_turns: 0, summary_turns: 0, recovery_required: false }
  const priority = (extra = {}) => capabilities({
    atomic_summary_protocol: 5, atomic_summary_isolation: 'shared-weights-priority-v1',
    atomic_summary_cold_start: false, atomic_summary_requires_foreground_warmup: true,
    atomic_summary_shared_weights: true, atomic_summary_serialized_compute: true,
    atomic_summary_experimental: true, atomic_summary_state_bank_provenance: 'experimental-user-validation',
    atomic_summary_state_bank_max_bytes: 1073741824, atomic_summary_qualified_envelope: null,
    atomic_summary_scheduler: scheduler, atomic_summary_continuation_text_only: false,
    atomic_summary_foreground_preparation: 'legacy-first-token-v1', atomic_summary_foreground_prefill_exclusive: true,
    ...extra,
  })
  it('accepts explicit native cold preparation while retaining weighted scheduling', async () => {
    respond(priority({ atomic_summary_cold_start: true, atomic_summary_requires_foreground_warmup: false,
      atomic_summary_resource_preparation: 'native-on-admission-v1' }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
      summarySlot: true, summaryQualifiedEnvelope: undefined, summaryMaxMainTokens: undefined,
      summaryStateBank: { protocol: 5, coldStart: true, requiresForegroundWarmup: false,
        resourcePreparation: 'native-on-admission-v1', scheduler: { policy: 'weighted-quanta-v1' } },
    })
  })
  it.each([undefined, null, 'unknown'])('rejects cold banks without native resource preparation %j', async preparation => {
    respond(priority({ atomic_summary_cold_start: true, atomic_summary_requires_foreground_warmup: false,
      atomic_summary_resource_preparation: preparation }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: false })
  })
  it.each([1, 8, 64])('accepts explicit scheduling with foreground weight %i', async foreground_weight => {
    respond(priority({ atomic_summary_scheduler: { ...scheduler, foreground_weight } }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({
      summarySlot: true, summaryTokenCounting: true, summaryQualifiedEnvelope: undefined,
      summaryMaxMainTokens: undefined, completionReview: false,
      summaryStateBank: { protocol: 5, context: 16384, coldStart: false, requiresForegroundWarmup: true,
        maxStateBytes: 1073741824, sharedWeights: true, serializedCompute: true, experimental: true,
        continuationTextOnly: false, foregroundPreparation: 'legacy-first-token-v1', foregroundPrefillExclusive: true,
        scheduler: { policy: 'weighted-quanta-v1', foregroundWeight: foreground_weight, summaryWeight: 1,
          computeSerialized: true, activeLane: null, foregroundTurns: 0, summaryTurns: 0, recoveryRequired: false } },
    })
  })
  it.each(['foreground', 'summary'])('accepts active %s without disabling summaries', async active_lane => {
    respond(priority({ atomic_summary_scheduler: { ...scheduler, active_lane, foreground_turns: 16, summary_turns: 2 } }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: true,
      summaryStateBank: { scheduler: { activeLane: active_lane, foregroundTurns: 16, summaryTurns: 2 } } })
  })
  it.each([
    undefined, null, [], {},
    ...['policy', 'foreground_weight', 'summary_weight', 'compute_serialized', 'active_lane',
      'foreground_turns', 'summary_turns', 'recovery_required'].map(key => ({ ...scheduler, [key]: undefined })),
    ...[0, -1, 65, 1.5, '8', Infinity, NaN].map(foreground_weight => ({ ...scheduler, foreground_weight })),
    ...[0, 2, '1'].map(summary_weight => ({ ...scheduler, summary_weight })),
    ...[-1, 1.5, '0', Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap(turns => [
      { ...scheduler, foreground_turns: turns }, { ...scheduler, summary_turns: turns },
    ]),
    { ...scheduler, policy: 'foreground-until-idle' }, { ...scheduler, compute_serialized: false },
    { ...scheduler, active_lane: 'paused' }, { ...scheduler, recovery_required: true },
  ])('fails closed on unsupported or malformed scheduler %j', async atomic_summary_scheduler => {
    respond(priority({ atomic_summary_scheduler }))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: false,
      summaryTokenCounting: false, summaryStateBank: undefined, completionReview: false })
  })
  it.each([
    { atomic_summary_protocol: 4 }, { atomic_summary_protocol: '5' }, { atomic_summary_protocol: 6 },
    { atomic_summary_isolation: 'shared-weights-state-bank-v1' },
    { atomic_summary_continuation_text_only: true }, { atomic_summary_continuation_text_only: undefined },
    { atomic_summary_continuation_text_only: 'false' }, { atomic_summary_foreground_preparation: undefined },
    { atomic_summary_foreground_preparation: 'parallel-prefill' },
    { atomic_summary_foreground_prefill_exclusive: false }, { atomic_summary_foreground_prefill_exclusive: undefined },
    { atomic_summary_cold_start: true }, { atomic_summary_requires_foreground_warmup: false },
    { atomic_summary_shared_weights: false }, { atomic_summary_serialized_compute: false },
    { atomic_summary_experimental: false }, { atomic_summary_state_bank_provenance: 'qualified' },
    { atomic_summary_qualified_envelope: envelope }, { atomic_summary_qualified_envelope: undefined },
    { atomic_summary_state_bank_max_bytes: 0 }, { atomic_summary_state_bank_max_bytes: 1.5 },
    { atomic_summary_state_bank_max_bytes: '1073741824' }, { atomic_summary_state_bank_max_bytes: Infinity },
    { atomic_summary_state_bank_max_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { atomic_summary_context: 8192 }, { atomic_summary_token_count: false }, { atomic_summary_slot: false },
    { data: [{ id: STRATA_MODEL, context_length: 8192 }] }, { runtime_id: undefined },
    { atomic_model_fingerprint: undefined },
  ])('does not infer priority support from contradictory fields %j', async extra => {
    respond(priority(extra))
    expect(await probeLocalModelCapabilities(provider, model)).toMatchObject({ summarySlot: false,
      summaryTokenCounting: false, summaryQualifiedEnvelope: undefined, completionReview: false })
  })
})

describe('explicit completion review opt-in', () => {
  const priority = (extra = {}) => capabilities({
    atomic_completion_review: false, atomic_completion_review_experimental: true,
    atomic_summary_protocol: 5, atomic_summary_isolation: 'shared-weights-priority-v1',
    atomic_summary_cold_start: false, atomic_summary_requires_foreground_warmup: true,
    atomic_summary_shared_weights: true, atomic_summary_serialized_compute: true,
    atomic_summary_experimental: true, atomic_summary_state_bank_provenance: 'experimental-user-validation',
    atomic_summary_state_bank_max_bytes: 1073741824, atomic_summary_qualified_envelope: null,
    atomic_summary_scheduler: { policy: 'weighted-quanta-v1', foreground_weight: 8, summary_weight: 1,
      compute_serialized: true, active_lane: null, foreground_turns: 0, summary_turns: 0, recovery_required: false },
    atomic_summary_continuation_text_only: false, atomic_summary_foreground_preparation: 'legacy-first-token-v1',
    atomic_summary_foreground_prefill_exclusive: true, ...extra,
  })
  it.each([undefined, false, 'true', 1, null])('never enables review without strict opt-in: %j', async enabled => {
    respond(priority())
    expect((await probeLocalModelCapabilities(provider, model, { completionReviewEnabled: enabled as boolean }))?.completionReview).toBe(false)
  })
  it('accepts opted-in experimental transport without claiming semantic qualification', async () => {
    respond(priority())
    expect(await probeLocalModelCapabilities(provider, model, { completionReviewEnabled: true })).toMatchObject({
      completionReview: true, summarySlot: true, summaryStateBank: { protocol: 5, experimental: true },
    })
  })
  it.each([
    { atomic_completion_review_experimental: undefined }, { atomic_completion_review_experimental: false },
    { atomic_completion_review_experimental: 'true' }, { atomic_summary_slot: false },
    { runtime_id: undefined }, { atomic_model_fingerprint: undefined }, { atomic_summary_scheduler: null },
    { atomic_summary_token_count: false }, { atomic_summary_foreground_prefill_exclusive: false },
  ])('skips unsupported or unhealthy Strata even when opted in: %j', async extra => {
    respond(priority(extra))
    expect((await probeLocalModelCapabilities(provider, model, { completionReviewEnabled: true }))?.completionReview).toBe(false)
  })
  it('does not re-enable legacy Strata qualification flags as experimental support', async () => {
    respond(capabilities({ atomic_completion_review: true, atomic_completion_review_experimental: true }))
    expect((await probeLocalModelCapabilities(provider, model, { completionReviewEnabled: true }))?.completionReview).toBe(false)
  })
  it.each([true, false, undefined, 'true'])('requires the actual Dstar advertisement: %j', async advertisement => {
    respond({ data: [{ id: 'dstar-model', context_length: 65536 }], atomic_completion_review: advertisement })
    expect((await probeLocalModelCapabilities({ provider: 'dstar', base_url: 'http://localhost:8010/v1', models: [] },
      { id: 'dstar-model' }, { completionReviewEnabled: true }))?.completionReview).toBe(advertisement === true)
  })
})


describe('Dstar cached-summary negotiation', () => {
  const provider = { provider: 'dstar', base_url: 'http://localhost:8010/v1', models: [] }
  const model = { id: 'qwen3.8-flash-next' }
  const clone = { data: [{ id: model.id, context_length: 65536 }], runtime_id: 'dstar-a',
    atomic_model_fingerprint: 'qwen-config', atomic_summary_slot: true, atomic_summary_clone: true,
    atomic_summary_stream_progress: true, atomic_summary_context: 16384, atomic_summary_token_count: true,
    atomic_tool_preamble: 4 }
  it('enables the shared clone adapter only for an explicit complete Dstar contract', async () => {
    respond(clone)
    const first = await probeLocalModelCapabilities(provider, model)
    expect(first).toMatchObject({ engine: 'dstar', summaryClone: true, summarySlot: true,
      summaryStreamProgress: true, summaryTokenCounting: true, toolPolicy: 'dstar-markers' })
    respond({ ...clone, runtime_id: 'dstar-b' })
    const next = await probeLocalModelCapabilities(provider, model)
    expect(next?.archiveScope).toBe(first?.archiveScope)
    expect(next?.runtimeScope).not.toBe(first?.runtimeScope)
  })
  it.each([{ atomic_summary_clone: false }, { runtime_id: undefined },
    { atomic_summary_context: 8192 }, { atomic_summary_token_count: false }, { atomic_summary_slot: false }])(
    'retains the legacy path for an incomplete clone advertisement: %j', async missing => {
      respond({ ...clone, ...missing })
      expect((await probeLocalModelCapabilities(provider, model))?.summaryClone).toBeUndefined()
    })
})
