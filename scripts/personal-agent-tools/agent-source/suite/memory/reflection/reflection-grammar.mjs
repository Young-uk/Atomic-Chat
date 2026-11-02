const REFLECTION_GRAMMAR = `root      ::= none | entries
none      ::= "NONE" "\\n"?
entries   ::= entry entry? entry? entry? entry? entry?
entry     ::= set | note | evolve
set       ::= "SET " key "=" value "\\n"
note      ::= "NOTE " typemark? body "\\n"
evolve    ::= "EVOLVE #" digits " [tags=" taglist "]" "\\n"
typemark  ::= "[type=" notetype "] "
notetype  ::= "event" | "behavior" | "knowledge" | "skill"
key       ::= [a-z] [a-z0-9_]{0,31}
value     ::= [^\\n]{1,200}
body      ::= [^\\n]{1,500}
digits    ::= [0-9]+
taglist   ::= tag ("," tag){0,9}
tag       ::= [a-zA-Z0-9_-]{1,32}
`;
const NOTE_TYPES = ["event", "behavior", "knowledge", "skill"];
export {
  NOTE_TYPES,
  REFLECTION_GRAMMAR
};
