# Stable model tool JSON across native persistence

Status: accepted

Rust persistence sorts JSON object keys. Live tool calls retain generation order, and Qwen renders argument mappings in that order. Reopening a thread could therefore change token history despite identical argument values. A real disk snapshot round-tripped exactly for 46,184 tokens; sorting two tool argument maps changed the token stream first at 44,945. Its only persisted checkpoint was at 46,090, after the mismatch, so the native runtime correctly declined reuse and reread the prompt.

Project tool inputs and outputs into stable recursive JSON key order before model-message conversion for managed Dstar/Strata runtimes. Use the same projection for generation, summary estimates and cache planning. Preserve array order, raw strings, non-JSON values, actual execution arguments and persisted evidence. Tool schemas already have stable function order. This fixes input identity; it does not bypass native checkpoint validation or change disk cache admission.

A regression emulates serde_json key sorting and compares the complete AI SDK model wire JSON before and after persistence. It also verifies the original arguments and literal JSON strings remain unchanged. Existing noncanonical cache histories may need one normal read; subsequent completed tool turns use the stable projection. No model inference test is initiated.
