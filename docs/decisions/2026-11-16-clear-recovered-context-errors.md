# Clear recovered context errors

A preflight overflow was persisted on a tool-running assistant turn. Emergency summarization reduced the prompt from 130,219 to 69,100 tokens and the final response completed, but spreading the earlier metadata kept `turn_error` on the successful response.

Successful final persistence now removes the inherited failure marker without mutating the original UI message. Failed or aborted requests keep their existing semantics. At the user’s request, the thread page does not render a context-limit error card, including legacy persisted errors; automatic summary recovery and other error cards remain unchanged.

Validation: regression coverage for successful recovery retaining unrelated metadata and leaving the original message intact; existing failed-turn and emergency recovery suites, full verification, and personal release build.
