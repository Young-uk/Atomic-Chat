# Live working timeline and bounded thinking preview

Render chat parts in their recorded order, combining only adjacent reasoning
parts or tool calls. A later visible remark, tool or thought finishes the earlier
reasoning phase. Keep the first activity row's key stable as its first tool arrives;
attach turn-wide agent diagnostics only once. This is a display projection, not a
mutation of stored messages, tool results or model requests.

New live reasoning opens a small, subdued preview capped at 10rem. Keep that clip
mounted and bounded when the phase completes to avoid moving the conversation.
Historical blocks start collapsed. A reader toggle takes precedence over automatic
preview, and explicitly reopening exposes the full trace. Only the bounded live
preview follows its inner tail; user scrolling pauses it, while a full expansion
leaves scrolling to the outer conversation. Thinking timers follow each reasoning
phase rather than the entire tool-dependent request.

Validate recorded order, stable keys and reader overrides with unit tests. Measure
auto-open, height bounds, completion stability, inner tail following and horizontal
overflow in Chromium at 1024/1280 widths, Medium/Extra Large fonts and both themes.
Existing permissions, inference scheduling, prompt policy and cache protocols are
unchanged by this UI change.
