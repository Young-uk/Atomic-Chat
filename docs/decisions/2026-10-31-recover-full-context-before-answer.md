# Recover an already full context before answering

Status: implemented locally; not published.

Normal compaction remains after a successful complete answer, at 70 percent
usage, retaining recent complete turns totaling about 20 percent of context.
An already full conversation cannot reach that successful finish. On the local
Dstar preflight context-limit error or an initial provider context rejection, release the foreground priority lease,
await the existing summary job or create one from the original UI history, and
retry transport preparation once. The pending question stays in the retained
newest turn. Only invisible SDK start envelopes are buffered to catch initial provider
rejections; progress or content is forwarded immediately and never replayed.
Other provider HTTP failures are not blindly replayed. The original archive must be persisted before summary inference and
the verified summary persisted before retry.

User abort cancels waiting and prevents retry; a background job already safely
started may finish for a later attempt. Archive or inference failure stops the
request without deleting source or retry loops. A single indivisible latest turn
that still cannot fit returns the normal context error after the bounded retry.
No threshold, retention fraction, summary prompt, model parameters, server
scheduler, original conversation or archive format changes.
