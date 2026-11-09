# Model context metadata and stable summary progress

Read the architecture-specific context_length from the selected GGUF metadata without loading tensors. Expose it separately from the configured runtime context. Dstar uses each model choice; Strata uses its pinned IQ3 model. The adjacent slider uses this declared model window. Missing metadata does not invent a limit. Explicit numeric extensions remain possible within the native integer bound; saved contexts and defaults remain unchanged.

Foreground and background summary responses have separate progress owners. Once a request emits reasoning or output, delayed prefill heartbeats cannot regress it to reading/preparing. A fresh request still starts in the normal input phase. Input completion is not output completion.

A running v31 Strata instance advertised cache-clone support but native summary logs reported cloned=0 with multiple 16K requests. The existing transport excludes model messages containing file parts from the text-only clone path; historical screenshot tool results can project to such parts. Preserve image semantics and this eligibility guard. Display clone versus segmented mode and the image/runtime fallback reason instead of suggesting every summary uses cloning. This change does not enable multimodal cache cloning or silently discard historical screenshots.

Installation remains deferred at the user's request. Do not interrupt the running summary for these source changes. Validate with frontend unit tests, native metadata fixtures and the real-browser layout gate; model inference remains user-driven.
