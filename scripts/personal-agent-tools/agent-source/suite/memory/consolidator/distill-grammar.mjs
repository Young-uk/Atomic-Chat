const DISTILL_GRAMMAR = `root ::= lesson "\\n"
lesson ::= "LESSON activation=" qstr "; principle=" qstr opt-tags
opt-tags ::= ("; tags=" taglist)?
taglist ::= tagid ("," tagid){2,5}
tagid ::= [a-z][a-z0-9\\-]{0,23}
qstr ::= "\\"" qchar+ "\\""
qchar ::= [\\t\\x20-\\x21] | [\\x23-\\x7e]
`;
const DISTILL_WITH_PROCEDURE_GRAMMAR = `root ::= lesson "\\n" opt-procedure
lesson ::= "LESSON activation=" qstr "; principle=" qstr opt-tags
opt-procedure ::= ("PROCEDURE activation=" qstr "; steps=" qstr opt-tags "\\n")?
opt-tags ::= ("; tags=" taglist)?
taglist ::= tagid ("," tagid){2,5}
tagid ::= [a-z][a-z0-9\\-]{0,23}
qstr ::= "\\"" qchar+ "\\""
qchar ::= [\\t\\x20-\\x21] | [\\x23-\\x7e]
`;
export {
  DISTILL_GRAMMAR,
  DISTILL_WITH_PROCEDURE_GRAMMAR
};
