const MARKER_RE = /\[redacted:[A-Za-z0-9_.-]{1,64}\]/g;
function countMarkers(text) {
  const counts = /* @__PURE__ */ new Map();
  if (!text.includes("[redacted:")) return counts;
  for (const match of text.matchAll(MARKER_RE)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}
function addedMaskedMarker(before, after) {
  const added = countMarkers(after);
  if (added.size === 0) return null;
  const had = countMarkers(before);
  for (const [marker, count] of added) {
    if (count > (had.get(marker) ?? 0)) return marker;
  }
  return null;
}
function refuseMaskedSecretWrite(tool, display, before, after) {
  const marker = addedMaskedMarker(before, after);
  if (marker === null) return;
  throw new Error(
    `${tool}: this text contains a masked secret (${marker}) that is not in ${display}; writing it would replace the real value with the marker. Nothing was written. Edit around that line instead (os.fs.edit on the lines you need to change), and leave the masked value out of your text.`
  );
}
export {
  addedMaskedMarker,
  refuseMaskedSecretWrite
};
