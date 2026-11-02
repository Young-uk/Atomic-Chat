const MAX_LISTING_SUMMARY_CHARS = 4e3;
const MIN_LISTING_SUMMARY_CHARS = 400;
function listingResultCaps(rows, charsPerRow) {
  if (!Number.isFinite(rows) || !Number.isFinite(charsPerRow)) {
    return {
      maxSummaryLength: MIN_LISTING_SUMMARY_CHARS,
      maxTailLines: Number.MAX_SAFE_INTEGER
    };
  }
  const budget = (Math.max(0, Math.floor(rows)) + 1) * charsPerRow;
  return {
    maxSummaryLength: Math.min(
      MAX_LISTING_SUMMARY_CHARS,
      Math.max(MIN_LISTING_SUMMARY_CHARS, budget)
    ),
    // Number.MAX_SAFE_INTEGER, not a big number: `extractTail` keeps
    // the LAST N lines, which is exactly backwards for an ordered
    // list. Any finite N would eventually eat the newest rows.
    maxTailLines: Number.MAX_SAFE_INTEGER
  };
}
export {
  MAX_LISTING_SUMMARY_CHARS,
  MIN_LISTING_SUMMARY_CHARS,
  listingResultCaps
};
