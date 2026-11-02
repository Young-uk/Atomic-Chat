import { REWRITTEN_QUERY_MAX_LENGTH } from "./query-rewriter-parser.mjs";
const QUERY_REWRITER_RESPONSE_FORMAT = {
  name: "query_rewriter_v1",
  description: 'Rewrite the latest ambiguous user message into a self-contained search query. Use the literal token "NONE" when no rewrite is possible.',
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      rewritten_query: {
        type: "string",
        maxLength: REWRITTEN_QUERY_MAX_LENGTH
      }
    },
    required: ["rewritten_query"]
  }
};
export {
  QUERY_REWRITER_RESPONSE_FORMAT
};
