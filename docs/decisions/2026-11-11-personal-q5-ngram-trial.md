# Personal Q5_1 n-gram trial

Keep the ISTA IQ3_XXS dense and expert weights, and replace only the 28.8 GB IQ4_NL n-gram table with AtomicChat's 38.4 GB Q5_1 table. Both tables have shape [160, 320001536]; sampled row cosine similarity exceeds 0.995. This supports compatibility, not an accuracy claim. The downloaded artifact is pinned by revision and SHA-256. Its 192-byte GGUF header is adapted to the existing two-shard metadata, with the tensor type set to Q5_1; the quantized payload is unchanged.

Retain the fully hash-verified original on SD. Requalify the exact installed model and use a separate disk cache directory. Do not migrate IQ4_NL KV sessions because the n-gram changes model activations. Context and summary policy are unchanged. This is a reversible personal experiment, not a general backend default.
