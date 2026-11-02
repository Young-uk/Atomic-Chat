const PROFILE_SECTION_EMPTY = "(no profile)";
const PROFILE_SECTION_CAPTION = "Facts about the user. Keys are labels, not skill or tool names.";
function renderProfileSection(facts, options = {}) {
  const selected = selectProfileFacts(facts, options);
  if (selected.length === 0) return PROFILE_SECTION_EMPTY;
  return selected.map(renderProfileLine).join("\n");
}
function renderProfileLine(fact) {
  return `- ${fact.key}: ${escapeValue(fact.value)}`;
}
function selectProfileFacts(facts, options = {}) {
  const gate = options.contextualKeywordGate ?? true;
  const message = (options.userMessage ?? "").toLowerCase();
  const threshold = options.profileFilterThreshold ?? 0;
  const voteHidden = (fact) => threshold > 0 && fact.voteScore <= -threshold;
  const filtered = facts.filter((fact) => {
    if (voteHidden(fact)) return false;
    if (!gate) return true;
    if (fact.pinned) return true;
    if (!message) return false;
    if (fact.keywords.length === 0) return false;
    return fact.keywords.some((keyword) => matchesKeyword(message, keyword));
  });
  return filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}
function escapeValue(raw) {
  if (!raw.includes("\n") && !raw.includes("\r")) return raw;
  return raw.replace(/\r?\n/g, " \\n ").replace(/\r/g, " \\r ");
}
function matchesKeyword(haystack, keyword) {
  const needle = keyword.toLowerCase();
  if (needle.length === 0) return false;
  let from = 0;
  for (; ; ) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return false;
    const before = idx === 0 ? "" : haystack[idx - 1];
    const afterIdx = idx + needle.length;
    const after = afterIdx >= haystack.length ? "" : haystack[afterIdx];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = idx + 1;
  }
}
function isWordChar(ch) {
  if (ch === "") return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95;
}
export {
  PROFILE_SECTION_CAPTION,
  PROFILE_SECTION_EMPTY,
  renderProfileLine,
  renderProfileSection,
  selectProfileFacts
};
