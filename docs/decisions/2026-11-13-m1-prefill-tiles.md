# M1 Max prefill tiles and native progress

## Decision

Use the qualified Metal candidate with `STRATA_METAL_PROMPT_GU_K=32` in the personal M1 Max launch policy. Keep the 4096-row input chunk, dynamic context/cache sizing, int8 KV, original IQ4_NL n-gram table, and MTP disabled. The shared Strata engine keeps its original tile unless the option is set.

The new native reports genuine completed Metal segments to the watchdog and reads macOS disk/page-in and memory statistics. Detailed CPU timing and split-encoder GPU timestamps are diagnostic options, disabled in this app policy. The watchdog timeout is unchanged.

## Evidence and limits

On the 64 GiB M1 Max with the same IQ3_XXS pack and 128K context, 18 GPU comparisons (six quantization formats at 17, 256, and 4096 rows) preserved the final expert output and intermediate activations bit for bit. A repeated 6585-token comparison produced matching output and higher input throughput with the candidate. A 17585-token comparison measured 192.8 versus 204.8 input tokens/s; both subsequent requests reused 17578 tokens. These are local sequential measurements, not a guarantee for another device, pack, or chunk size.

GDN and flash-QSA alternatives did not improve whole-model performance here. MTP early-confidence blocks preserved output, including seeded sampling, but did not give a convincing decode improvement; that prototype was removed. This update does not enable MTP or change summary/review concurrency.

## Cache compatibility

The native checkpoint layout, model files, tokenizer, and KV geometry are unchanged. A reviewed disk identity bridge accepts only the exact previously qualified original-IQ4 128K production pins. Native checkpoint validation remains mandatory; historical Q5-table identities are not admitted. The app verifies its new 64K baseline pins before deriving the configured context and cache capacities.

## Validation

Native build, model-free CPU/GPU progress tests, GPU output parity, and checkpoint transfer tests precede installation. Run the app policy tests, clean-environment live pin calculation, `make verify`, Rust checks, and a signed-app restart before reporting delivery. Confirm the existing production disk cache restores and summary support stays enabled.
