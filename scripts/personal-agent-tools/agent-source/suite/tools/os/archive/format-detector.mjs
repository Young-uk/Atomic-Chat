function detectArchiveFormat(filename, head) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".zip")) {
    return isZipMagic(head) ? "zip" : null;
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return isGzipMagic(head) ? "tar.gz" : null;
  }
  if (lower.endsWith(".tar")) {
    return isTarMagic(head) ? "tar" : null;
  }
  if (lower.endsWith(".gz")) {
    return isGzipMagic(head) ? "gz" : null;
  }
  if (isZipMagic(head)) return "zip";
  if (isTarMagic(head)) return "tar";
  if (isGzipMagic(head)) return "gz";
  return null;
}
function isZipMagic(head) {
  if (head.length < 4) return false;
  const b0 = head[0];
  const b1 = head[1];
  const b2 = head[2];
  const b3 = head[3];
  if (b0 !== 80 || b1 !== 75) return false;
  if (b2 === 3 && b3 === 4) return true;
  if (b2 === 5 && b3 === 6) return true;
  if (b2 === 7 && b3 === 8) return true;
  return false;
}
function isGzipMagic(head) {
  return head.length >= 2 && head[0] === 31 && head[1] === 139;
}
function isTarMagic(head) {
  if (head.length < 265) return false;
  const ustar = head.subarray(257, 263).toString("ascii");
  return ustar === "ustar\0" || ustar.startsWith("ustar ");
}
export {
  detectArchiveFormat,
  isGzipMagic,
  isTarMagic,
  isZipMagic
};
