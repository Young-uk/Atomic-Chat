# Restore the original personal n-gram table

Restore the hash-verified 28,800,138,432-byte IQ4_NL n-gram shard from the original ISTA IQ3_XXS SD backup. Leave both the original and Q5_1 SD artifacts untouched. Dense/expert weights, context and inference policy remain unchanged. Requalify the restored model fingerprint and use a distinct IQ4_NL disk-session directory. Remove historical Q5_1 cache bridges: changing the embedding table changes activations, so Q5_1 KV state must never be admitted. The first request will prefill again.
