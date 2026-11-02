function parsePorcelain(stdout) {
  if (!stdout) return { entries: [], branchInfo: null };
  const records = stdout.split("\0");
  const entries = [];
  let branchInfo = null;
  let i = 0;
  while (i < records.length) {
    const rec = records[i];
    if (rec === void 0 || rec === "") {
      i++;
      continue;
    }
    if (rec.startsWith("## ")) {
      branchInfo = rec.slice(3);
      i++;
      continue;
    }
    const indexStatus = rec.charAt(0);
    const workingStatus = rec.charAt(1);
    const path = rec.slice(3);
    const entry = { path, indexStatus, workingStatus };
    if (indexStatus === "R" || indexStatus === "C") {
      const orig = records[i + 1];
      if (orig !== void 0) {
        entry.renamedFrom = orig;
        i += 2;
      } else {
        i++;
      }
    } else {
      i++;
    }
    entries.push(entry);
  }
  return { entries, branchInfo };
}
export {
  parsePorcelain
};
