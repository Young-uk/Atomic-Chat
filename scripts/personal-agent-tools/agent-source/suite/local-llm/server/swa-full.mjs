import {
  buildKvLayout,
  countKvLayers,
  estimateKvBytesPerToken,
  MANAGED_KV_CACHE_TYPE
} from "./context-size.mjs";
const SWA_FULL_PREFERENCES = [
  "auto",
  "on",
  "off"
];
function isSwaFullPreference(value) {
  return typeof value === "string" && SWA_FULL_PREFERENCES.includes(value);
}
const SWA_FULL_MAX_RATIO = 8;
const SWA_FULL_BUDGET_SHARE = 0.6;
function resolveSwaFullDecision(input) {
  if (input.layout === null) {
    return {
      enabled: false,
      reason: "swa-full: off \u2014 model header unreadable, layout unknown",
      estimate: null,
      slidingLayers: 0
    };
  }
  const layout = buildKvLayout(input.layout);
  const counts = countKvLayers(layout);
  if (counts.swa === 0) {
    return {
      enabled: false,
      reason: "swa-full: not applicable \u2014 no sliding-window layers",
      estimate: null,
      slidingLayers: 0
    };
  }
  const cacheType = input.cacheType ?? MANAGED_KV_CACHE_TYPE;
  const ctx = Math.max(1, input.contextSize);
  const perTokenSwa = estimateKvBytesPerToken(layout, cacheType, ctx);
  const nonSliding = Math.max(1, counts.total - counts.swa);
  const rawRatio = counts.total / nonSliding;
  const capped = rawRatio > SWA_FULL_MAX_RATIO;
  const ratio = capped ? SWA_FULL_MAX_RATIO : rawRatio;
  const estimate = {
    swa: perTokenSwa * ctx,
    full: perTokenSwa * ratio * ctx,
    ratio,
    capped
  };
  const layers = `${counts.swa} of ${counts.total} layers slide`;
  const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;
  const figures = `estimate: KV ${gb(estimate.swa)} with SWA, ~${gb(estimate.full)} full (\xD7${ratio.toFixed(1)}${capped ? ", capped" : ""}) at ${ctx} tokens`;
  if (input.preference === "off") {
    return {
      enabled: false,
      reason: `swa-full: off (configured) \u2014 ${layers}; ${figures}`,
      estimate,
      slidingLayers: counts.swa
    };
  }
  if (input.preference === "on") {
    return {
      enabled: true,
      reason: `swa-full: on (configured) \u2014 ${layers}; ${figures}`,
      estimate,
      slidingLayers: counts.swa
    };
  }
  if (input.kvBudgetBytes === null) {
    return {
      enabled: false,
      reason: `swa-full: off (auto) \u2014 no memory budget known to fit against; ${layers}; ${figures}`,
      estimate,
      slidingLayers: counts.swa
    };
  }
  const ceiling = input.kvBudgetBytes * SWA_FULL_BUDGET_SHARE;
  const fits = estimate.full <= ceiling;
  return {
    enabled: fits,
    reason: fits ? `swa-full: on (auto) \u2014 full-SWA estimate fits ${gb(ceiling)} of the ${gb(input.kvBudgetBytes)} KV budget; ${layers}; ${figures}` : `swa-full: off (auto) \u2014 full-SWA estimate needs more than ${gb(ceiling)} of the ${gb(input.kvBudgetBytes)} KV budget; ${layers}; ${figures}`,
    estimate,
    slidingLayers: counts.swa
  };
}
export {
  SWA_FULL_BUDGET_SHARE,
  SWA_FULL_MAX_RATIO,
  SWA_FULL_PREFERENCES,
  isSwaFullPreference,
  resolveSwaFullDecision
};
