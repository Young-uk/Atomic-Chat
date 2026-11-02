const LINK_GENERATOR_GRAMMAR = `root    ::= none | entries
none    ::= "NONE" "\\n"?
entries ::= entry entry? entry? entry?
entry   ::= "LINK " digit+ " " digit+ " [kind=" kind "]" "\\n"
kind    ::= "RELATES_TO" | "CAUSED_BY" | "REFERENCES" | "CONTRADICTS" | "DUPLICATES" | "SUPERSEDES"
digit   ::= [0-9]
`;
export {
  LINK_GENERATOR_GRAMMAR
};
