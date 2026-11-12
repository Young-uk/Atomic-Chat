# Natural working commentary

Replace the mandatory pre-tool announcement in the plain chat policy with optional,
useful observations, reactions, uncertainty and changes of approach in the assistant's
usual voice. Do not impose a timer or an announce-act-report sequence. Keep private
reasoning private and preserve tool execution, completion, approvals and cancellation
requirements. Dstar's legacy Qwen preamble follows the same conversational policy.

This changes the existing instructions directly, as requested by the user. Historical
rendered prompts can therefore change once; no new metadata, migration or extra
inference loop is introduced. Existing visible-text/tool streams and tool-result
continuations are unchanged. This does not add speech generation while a tool blocks
the model, nor promise arbitrary reasoning/content alternation from every model.

Prefer visible working updates over silence. Share useful findings, assessments and
reactions before or between calls and after meaningful results, while keeping private
reasoning private. Do not require an announcement for every call or a fixed cadence.
