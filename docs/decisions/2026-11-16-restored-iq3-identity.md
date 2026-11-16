# Restored original IQ3 file identity

Restoring the original IQ3_XXS n-gram GGUF from SD changes its inode and timestamps. The stat-based qualification therefore changes even when the weights are identical.

The restored 28,800,138,432-byte file was checked against SHA-256 `316b46f3a2dbd68c900f43136ab9449f9dcc3725dfd8c794847c204bc161e113`. Native and backend hashes remain unchanged. Update only the qualified model fingerprint, calculated under the exact app launch environment.

The existing 128K disk session is admitted through an exact previous/current qualification bridge. This does not admit Q5_1 tables or arbitrary replacement weights. Preserve all native, backend, cache format, geometry, and context checks.

Validate the real app-generated 64K and 128K configurations, then run the normal app verification and build gates. The production settings remain 131072 context, 4096 prefill, and MTP disabled.
