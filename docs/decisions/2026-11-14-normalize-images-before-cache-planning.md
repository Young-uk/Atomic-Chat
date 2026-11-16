# Normalize images before cache planning and token counting

ModelMessage file data can be a data URL string. The provider serializer expects an already normalized model prompt; passing that string directly added a second data URL header. Exact counting rejected the malformed image before prepared-summary pressure adoption could run.

Normalize user file/image parts into provider file parts, convert URL strings to URL objects, and convert ArrayBuffer data to Uint8Array before the existing provider serializer. Preserve image bytes and raw base64. Use the shared history serializer for counting, summary planning, and cache alignment. No server qualification, context limit, summary instructions, or source archive changes.

Validation: regression cases cover data URLs, raw base64, binary data and image parts. A read-only count of the affected saved image succeeds with the corrected URL; no model generation or KV mutation is requested.
