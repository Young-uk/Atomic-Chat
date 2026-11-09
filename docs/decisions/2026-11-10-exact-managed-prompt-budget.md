# Exact managed prompt budgets

Managed Dstar and Strata requests previously used a character heuristic for foreground admission. A 52,603-token estimate admitted a 66,029-token prompt into a 65,536-token context.

Count the final serialized Chat Completions body after provider parameters are merged and before native streaming. Apply the same check to tool continuations. The engine counting endpoint uses the generation parser, template and tokenizer, returns the active context and output reserve, and does not generate or mutate recurrent state. Missing, invalid or failed counts block dispatch instead of using a heuristic. No runtime is started for counting.

Dstar image counts use the same CPU preprocessing and position-dependent layout as generation, without running its vision tower. Strata counts prepare new images on the existing image FIFO and reuse cached embeddings and their token counts; prepared image bytes are returned to the app so a remote URL cannot change between counting and generation. Existing images are not re-encoded for counting. Text-only counts remain CPU-only. Summary memory admission remains separate. Existing heuristic usage estimates remain provisional UI/background scheduling information, not a proof that a final request fits.
