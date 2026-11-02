const SYNTAX_ERROR_MAX_CHARS = 600;
function tailOfOutput(text, lines = 5) {
  const kept = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).slice(-lines).join("\n");
  return kept.length > SYNTAX_ERROR_MAX_CHARS ? `\u2026${kept.slice(-SYNTAX_ERROR_MAX_CHARS)}` : kept;
}
export {
  SYNTAX_ERROR_MAX_CHARS,
  tailOfOutput
};
