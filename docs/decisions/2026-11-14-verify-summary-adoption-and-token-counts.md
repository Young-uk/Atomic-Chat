---
date: 2026-11-14
title: "Verify summary adoption and count the actual foreground envelope"
---

# Verify summary adoption and count the actual foreground envelope

- Summary completion previously published a heuristic next-request size. Actual requests were already tokenizer-checked, but that count was not published to the context indicator. The observed 53,086 estimate became 74,867 tokens on the wire.
- Publish validated server tokenizer counts from the final serialized request, including tools, provider overrides and normalized image expansion. A summary preview uses the same OpenAI serializer, fixed instructions, tools and template options. Late previews cannot overwrite a newer foreground measurement. Counting does not mutate text KV state; existing image normalization remains shared with generation.
- A negative cache-boundary result must not count as a verified handoff. Strata keeps its prior active view while the saved replacement waits for a proven complete-turn boundary. Restart replay similarly defers an unadopted archive if it still belongs to the restored source cache. Source history and saved summaries remain intact.
- This is not a guarantee of arbitrary native cache alignment: the existing four-token/image constraints remain enforced. When the old envelope no longer fits, the existing foreground recovery path can adopt the saved summary and read a compacted input. No native protocol, summary prompt, review design or output limit changes.
- Tests cover exact displayed counts, unchanged prepared image bytes, failed adoption retaining the old view, later successful adoption, and restart replay. Existing transport and compaction suites remain regression gates.
