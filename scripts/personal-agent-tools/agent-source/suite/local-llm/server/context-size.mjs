const MIB_PER_GB = 1e9 / (1024 * 1024);
const VRAM_SAFETY_FRACTION = 0.92;
const COMPUTE_OVERHEAD_MIB = 768;
const UNIFIED_MEMORY_HEADROOM_SHARE = 0.25;
const UNIFIED_MEMORY_HEADROOM_MIN_MIB = 4 * 1024;
const UNIFIED_MEMORY_KV_SHARE = 1 / 16;
function resolveUnifiedMemoryHeadroomMiB(systemMemoryMiB) {
  return Math.max(
    UNIFIED_MEMORY_HEADROOM_MIN_MIB,
    systemMemoryMiB * UNIFIED_MEMORY_HEADROOM_SHARE
  );
}
function resolveUnifiedMemoryKvRoomMiB(input) {
  const weightsMiB = (input.modelSizeGb + input.mmprojSizeGb) * MIB_PER_GB;
  return input.systemMemoryMiB - resolveUnifiedMemoryHeadroomMiB(input.systemMemoryMiB) - weightsMiB - COMPUTE_OVERHEAD_MIB;
}
const KV_CACHE_BITS_PER_VALUE = {
  turbo3: 3.5,
  turbo4: 4.5,
  q4_0: 4.5,
  q4_1: 5,
  q5_0: 5.5,
  q5_1: 6,
  q8_0: 8.5,
  f16: 16,
  bf16: 16,
  f32: 32
};
const MANAGED_KV_CACHE_TYPE = "turbo3";
function kvBitsPerValue(cacheType) {
  return KV_CACHE_BITS_PER_VALUE[cacheType] ?? KV_CACHE_BITS_PER_VALUE.f16;
}
function buildKvLayout(source) {
  const window = typeof source.slidingWindow === "number" && source.slidingWindow > 0 ? source.slidingWindow : 0;
  const layers = [];
  for (let i = 0; i < source.blockCount; i += 1) {
    const heads = typeof source.headCountKv === "number" ? source.headCountKv : source.headCountKv[i] ?? source.headCountKv[0] ?? 0;
    const recurrent = source.recurrentLayerPattern?.[i] ?? (typeof source.fullAttentionInterval === "number" && source.fullAttentionInterval > 1 ? (i + 1) % source.fullAttentionInterval !== 0 : false);
    const slides = window > 0 && (source.slidingWindowPattern ? source.slidingWindowPattern[i] === true : true);
    const kind = recurrent ? "recurrent" : slides ? "swa" : "global";
    layers.push({
      kind,
      headCountKv: heads,
      keyLength: kind === "swa" ? source.keyLengthSwa ?? source.keyLength : source.keyLength,
      valueLength: kind === "swa" ? source.valueLengthSwa ?? source.valueLength : source.valueLength
    });
  }
  return { layers, slidingWindow: window };
}
function layerBytesPerToken(layer, bitsPerValue) {
  return layer.headCountKv * (layer.keyLength + layer.valueLength) * bitsPerValue / 8;
}
function estimateKvBytesTotal(layout, cacheType, ctx, options = {}) {
  const bits = kvBitsPerValue(cacheType);
  let total = 0;
  for (const layer of layout.layers) {
    if (layer.kind === "recurrent") continue;
    const perToken = layerBytesPerToken(layer, bits);
    const tokens = layer.kind === "swa" && !options.swaFull ? Math.min(layout.slidingWindow, ctx) : ctx;
    total += tokens * perToken;
  }
  return total;
}
function estimateKvBytesPerToken(layout, cacheType, ctx, options = {}) {
  if (!(ctx > 0)) return 0;
  return estimateKvBytesTotal(layout, cacheType, ctx, options) / ctx;
}
function countKvLayers(layout) {
  let global = 0;
  let swa = 0;
  let recurrent = 0;
  for (const layer of layout.layers) {
    if (layer.kind === "global") global += 1;
    else if (layer.kind === "swa") swa += 1;
    else recurrent += 1;
  }
  return { total: layout.layers.length, global, swa, recurrent };
}
const KV_BYTES_PER_TOKEN_PER_GB = 3200;
const KV_MIN_BYTES_PER_TOKEN = 48e3;
const MIN_AUTO_CONTEXT = 32768;
const MAX_AUTO_CONTEXT = 262144;
const NO_VRAM_DEFAULT_CONTEXT = MIN_AUTO_CONTEXT;
function roundDownTo(value, step) {
  return Math.max(step, Math.floor(value / step) * step);
}
function resolveKvBudgetMiB(input) {
  const usableMiB = input.freeVramMiB * VRAM_SAFETY_FRACTION;
  const weightsMiB = (input.modelSizeGb + input.mmprojSizeGb) * MIB_PER_GB;
  const fitMiB = usableMiB - weightsMiB - COMPUTE_OVERHEAD_MIB;
  const systemMemoryMiB = input.systemMemoryMiB;
  if (typeof systemMemoryMiB !== "number" || !(systemMemoryMiB > 0)) {
    return fitMiB;
  }
  return Math.min(
    fitMiB,
    resolveUnifiedMemoryKvRoomMiB({
      systemMemoryMiB,
      modelSizeGb: input.modelSizeGb,
      mmprojSizeGb: input.mmprojSizeGb
    })
  );
}
function resolveContextKvBudgetMiB(input) {
  const budgetMiB = resolveKvBudgetMiB(input);
  const systemMemoryMiB = input.systemMemoryMiB;
  if (typeof systemMemoryMiB !== "number" || !(systemMemoryMiB > 0)) {
    return budgetMiB;
  }
  return Math.min(budgetMiB, systemMemoryMiB * UNIFIED_MEMORY_KV_SHARE);
}
function fitContextToKvBudget(layout, cacheType, budgetBytes, options = {}) {
  if (!(budgetBytes > 0)) return 0;
  const bits = kvBitsPerValue(cacheType);
  let globalPerToken = 0;
  let swaPerToken = 0;
  for (const layer of layout.layers) {
    if (layer.kind === "recurrent") continue;
    const perToken = layerBytesPerToken(layer, bits);
    if (layer.kind === "swa" && !options.swaFull) swaPerToken += perToken;
    else globalPerToken += perToken;
  }
  const window = layout.slidingWindow;
  const allPerToken = globalPerToken + swaPerToken;
  if (allPerToken <= 0) return Number.POSITIVE_INFINITY;
  const belowWindow = budgetBytes / allPerToken;
  if (swaPerToken === 0 || belowWindow <= window) return Math.floor(belowWindow);
  if (globalPerToken <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((budgetBytes - window * swaPerToken) / globalPerToken);
}
function estimateContextSize(input) {
  const {
    freeVramMiB,
    modelSizeGb,
    mmprojSizeGb,
    maxContextLength,
    configuredContextSize
  } = input;
  const ceiling = maxContextLength > 0 ? maxContextLength : MAX_AUTO_CONTEXT;
  if (configuredContextSize > 0) {
    return Math.min(configuredContextSize, ceiling);
  }
  if (freeVramMiB === null || freeVramMiB <= 0) {
    return Math.min(NO_VRAM_DEFAULT_CONTEXT, ceiling);
  }
  const kvBudgetMiB = resolveContextKvBudgetMiB({
    freeVramMiB,
    modelSizeGb,
    mmprojSizeGb,
    systemMemoryMiB: input.systemMemoryMiB ?? null
  });
  const kvBudgetBytes = kvBudgetMiB > 0 ? kvBudgetMiB * 1024 * 1024 : 0;
  let fitTokens;
  if (input.kvLayout && input.kvLayout.layers.length > 0) {
    fitTokens = fitContextToKvBudget(
      input.kvLayout,
      input.cacheType ?? MANAGED_KV_CACHE_TYPE,
      kvBudgetBytes,
      { swaFull: input.swaFull === true }
    );
  } else {
    const kvBytesPerToken = Math.max(
      KV_MIN_BYTES_PER_TOKEN,
      modelSizeGb * KV_BYTES_PER_TOKEN_PER_GB
    );
    fitTokens = kvBudgetBytes / kvBytesPerToken;
  }
  const clamped = Math.min(
    MAX_AUTO_CONTEXT,
    Math.max(MIN_AUTO_CONTEXT, Math.floor(Math.min(fitTokens, MAX_AUTO_CONTEXT)))
  );
  return Math.min(roundDownTo(clamped, 1024), ceiling);
}
function estimateLaunchKvBytes(input) {
  if (input.kvLayout && input.kvLayout.layers.length > 0) {
    return estimateKvBytesTotal(
      input.kvLayout,
      input.cacheType ?? MANAGED_KV_CACHE_TYPE,
      input.contextSize,
      { swaFull: input.swaFull === true }
    );
  }
  return input.contextSize * Math.max(KV_MIN_BYTES_PER_TOKEN, input.modelSizeGb * KV_BYTES_PER_TOKEN_PER_GB);
}
function resolveDeviceFreeVramMiB(devices, device) {
  if (!device || device === "cpu") return null;
  const match = devices.find((d) => d.id === device);
  if (!match) return null;
  const free = match.freeMemMiB > 0 ? match.freeMemMiB : match.totalMemMiB;
  return free > 0 ? free : null;
}
export {
  KV_BYTES_PER_TOKEN_PER_GB,
  KV_CACHE_BITS_PER_VALUE,
  KV_MIN_BYTES_PER_TOKEN,
  MANAGED_KV_CACHE_TYPE,
  MAX_AUTO_CONTEXT,
  MIN_AUTO_CONTEXT,
  NO_VRAM_DEFAULT_CONTEXT,
  UNIFIED_MEMORY_HEADROOM_MIN_MIB,
  UNIFIED_MEMORY_HEADROOM_SHARE,
  UNIFIED_MEMORY_KV_SHARE,
  buildKvLayout,
  countKvLayers,
  estimateContextSize,
  estimateKvBytesPerToken,
  estimateKvBytesTotal,
  estimateLaunchKvBytes,
  fitContextToKvBudget,
  kvBitsPerValue,
  resolveContextKvBudgetMiB,
  resolveDeviceFreeVramMiB,
  resolveKvBudgetMiB,
  resolveUnifiedMemoryHeadroomMiB,
  resolveUnifiedMemoryKvRoomMiB
};
