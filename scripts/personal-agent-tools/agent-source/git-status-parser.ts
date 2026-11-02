/**
 * Each status entry corresponds to one path reported by
 * `git status --porcelain=v1 -z`. Codes are standard git:
 * ' ' = unmodified, M = modified, A = added, D = deleted, R = renamed,
 * C = copied, U = updated-but-unmerged, ? = untracked.
 */
export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  workingStatus: string;
  renamedFrom?: string;
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * Format:
 *   XY<SP><path>[<NUL><origPath>]<NUL>
 * where XY are two status codes (index + working tree). When the status
 * is `R` (rename) or `C` (copy), the ORIG path is emitted as a separate
 * NUL-delimited token right after the new path.
 *
 * The very first record may be `## <branch>...` pseudo-header when
 * `--branch` is passed — we extract that into branchInfo.
 */
export function parsePorcelain(stdout: string): {
  entries: GitStatusEntry[];
  branchInfo: string | null;
} {
  if (!stdout) return { entries: [], branchInfo: null };
  const records = stdout.split("\0");
  const entries: GitStatusEntry[] = [];
  let branchInfo: string | null = null;
  let i = 0;
  while (i < records.length) {
    const rec = records[i];
    if (rec === undefined || rec === "") {
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
    const entry: GitStatusEntry = { path, indexStatus, workingStatus };
    // Rename/copy: next token is the original path.
    if (indexStatus === "R" || indexStatus === "C") {
      const orig = records[i + 1];
      if (orig !== undefined) {
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
