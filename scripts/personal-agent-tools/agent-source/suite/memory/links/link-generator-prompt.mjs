const PREVIEW_CHARS = 120;
function buildLinkGeneratorPrompt(input) {
  const candidateBlock = input.candidates.map((c) => `[${c.id}] ${trimPreview(c.body, PREVIEW_CHARS)}`).join("\n");
  return [
    "Identify genuine relations between the candidate notes below.",
    "Output zero or more LINK lines, each:",
    "  LINK <from_id> <to_id> [kind=KIND]",
    "where KIND is one of:",
    "  RELATES_TO | CAUSED_BY | REFERENCES | CONTRADICTS | DUPLICATES | SUPERSEDES",
    "Use exactly the numeric ids shown in [brackets]. Do NOT invent ids.",
    "If nothing connects, output NONE.",
    "",
    "user-message:",
    truncate(input.userMessage, 600),
    "",
    "assistant-reply:",
    truncate(input.assistantReply, 600),
    "",
    "candidates:",
    candidateBlock.length > 0 ? candidateBlock : "(none)",
    "",
    "links:"
  ].join("\n");
}
function truncate(raw, max) {
  const s = raw.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}\u2026`;
}
function trimPreview(raw, max) {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`;
}
export {
  buildLinkGeneratorPrompt
};
