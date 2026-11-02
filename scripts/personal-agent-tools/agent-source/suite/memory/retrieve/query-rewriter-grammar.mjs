const QUERY_REWRITER_GRAMMAR = `root        ::= "<rewritten_query>" body "</rewritten_query>" "\\n"?
body        ::= [^<\\n]{1,400}
`;
export {
  QUERY_REWRITER_GRAMMAR
};
