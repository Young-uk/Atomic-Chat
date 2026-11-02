const MISSING_SELECTOR_GLOBAL = "__atagMissingSelectors";
const MISSING_SELECTOR_CAP = 100;
const MISSING_SELECTOR_INIT_SCRIPT = `(() => {
  const missing = [];
  window[${JSON.stringify(MISSING_SELECTOR_GLOBAL)}] = missing;
  const record = (kind, selector) => {
    const key = kind + " " + String(selector);
    if (missing.length < ${MISSING_SELECTOR_CAP} && !missing.includes(key)) missing.push(key);
  };
  const byId = Document.prototype.getElementById;
  Document.prototype.getElementById = function (id) {
    const found = byId.call(this, id);
    if (found === null) record("#", id);
    return found;
  };
  for (const proto of [Document.prototype, Element.prototype, DocumentFragment.prototype]) {
    const query = proto.querySelector;
    proto.querySelector = function (selector) {
      const found = query.call(this, selector);
      if (found === null) record("querySelector", selector);
      return found;
    };
  }
})();`;
const PROBE_INTERVAL_MS = 250;
const PROBE_MAX_SAMPLES = 40;
function downsample(samples, max = PROBE_MAX_SAMPLES) {
  if (samples.length <= max) return [...samples];
  const out = [];
  const last = samples.length - 1;
  for (let i = 0; i < max; i += 1) {
    out.push(samples[Math.round(i * last / (max - 1))]);
  }
  return out;
}
function normaliseProbeValue(value) {
  if (value === null || value === void 0) return value ?? null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 200 ? `${text.slice(0, 197)}\u2026` : value;
  }
  if (typeof value === "string" && value.length > 200) return `${value.slice(0, 197)}\u2026`;
  return value;
}
async function sampleProbes(probes, seconds, evaluate, signal) {
  const raw = {};
  for (const probe of probes) raw[probe.name] = [];
  if (probes.length === 0) return raw;
  const started = Date.now();
  const budget = seconds * 1e3;
  for (; ; ) {
    const t = Date.now() - started;
    if (t > budget || signal?.aborted) break;
    for (const probe of probes) {
      let value;
      try {
        value = normaliseProbeValue(await evaluate(probe.expr));
      } catch (err) {
        value = { error: err instanceof Error ? err.message : String(err) };
      }
      raw[probe.name].push([t, value]);
    }
    const next = PROBE_INTERVAL_MS - (Date.now() - started) % PROBE_INTERVAL_MS;
    await new Promise((resolve) => setTimeout(resolve, next));
  }
  const out = {};
  for (const [name, samples] of Object.entries(raw)) out[name] = downsample(samples);
  return out;
}
export {
  MISSING_SELECTOR_CAP,
  MISSING_SELECTOR_GLOBAL,
  MISSING_SELECTOR_INIT_SCRIPT,
  PROBE_INTERVAL_MS,
  PROBE_MAX_SAMPLES,
  downsample,
  normaliseProbeValue,
  sampleProbes
};
