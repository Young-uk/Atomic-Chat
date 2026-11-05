# Desktop controls and bounded crawl envelopes

## Decision

Enable the existing macOS screen tools in the Personal native adapter. Keep
source-native inspection/confirmation, protected target checks, and OS permission
checks. Preserve capture geometry across adapter invocations, and return generated
JPEG bytes together with geometry so the model can inspect the actual screen.
This does not grant macOS permissions or authorize actions outside a user's task.

The observed continuation failed after a Tavily crawl returned about 220,000
characters in the newest user turn. Recovery archived all earlier turns but could
not reduce that indivisible active turn; the heuristic envelope still exceeded
65,536 tokens. Summarizing more historical turns could not resolve that condition.

Project oversized Tavily crawl/extract results to explicit page excerpts (16,000
text characters, 4,000 per string, bounded metadata and a final hard size guard).
Keep complete original tool output in conversation storage, including existing
history. Preserve URLs for targeted subsequent extraction. Do not treat omitted
text as evidence. This changes the model's evidence envelope, not the stored
record or the summary thresholds. Image sanitization remains in force.

## Validation

Synthetic desktop probes verify discoverability and that denied OS permissions
produce errors without clicks or typing. Projection regression tests verify
bounded output, preserved originals/URLs, and unchanged small/unrelated results.
Physical desktop actions and installed app behavior require separate live checks.
