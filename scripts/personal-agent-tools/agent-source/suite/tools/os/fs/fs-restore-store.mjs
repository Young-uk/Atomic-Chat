import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  emptyManifest,
  normalizeManifest,
  normalizeSession,
  restoreKey,
  safeSegment,
  writeCopyExclusively,
  writeJsonAtomically
} from "./fs-restore-manifest.mjs";
import { restoreKey as restoreKey2 } from "./fs-restore-manifest.mjs";
const RESTORE_COPY_CAP = 20;
const RESTORE_MAX_BYTES = 5 * 1024 * 1024;
const CREATED_PATHS_CAP = 5e3;
const MANIFEST_FILE = "manifest.json";
const SESSIONS_DIR = "sessions";
class FileRestoreStore {
  constructor(root) {
    this.root = root;
  }
  /** One in-flight read-modify-write per index (see `serialised`). */
  chains = /* @__PURE__ */ new Map();
  /** `<root>/<restoreKey(workingDir)>` — the working directory's copies and manifest. */
  copiesDir(workingDir) {
    return join(this.root, restoreKey(workingDir));
  }
  /** `<root>/sessions/<sessionId>.json` — the paths this session created. */
  sessionFile(sessionId) {
    return join(this.root, SESSIONS_DIR, `${safeSegment(sessionId)}.json`);
  }
  /** Did a tool of this session create `absolute` (write to a path that did not exist)? */
  async wasCreated(sessionId, absolute) {
    return (await this.readSession(sessionId)).created.includes(absolute);
  }
  async recordCreated(sessionId, absolute) {
    await this.serialised(`session:${sessionId}`, async () => {
      const record = await this.readSession(sessionId);
      if (record.created.includes(absolute)) return;
      record.created.push(absolute);
      if (record.created.length > CREATED_PATHS_CAP) {
        record.created.splice(0, record.created.length - CREATED_PATHS_CAP);
      }
      await writeJsonAtomically(this.sessionFile(sessionId), record);
    });
  }
  /**
   * Save `content` as the previous content of `absolute`, a file under
   * (or reached from) `workingDir`. The caller has checked the size cap;
   * the bytes are stored as given so a restore puts back exactly what
   * was there. Past `RESTORE_COPY_CAP` the oldest copy of the working
   * directory — whichever path or session it belonged to — is removed.
   */
  async saveCopy(workingDir, absolute, content, meta) {
    const dir = this.copiesDir(workingDir);
    return this.serialised(`copies:${dir}`, async () => {
      await mkdir(dir, { recursive: true });
      const manifest = await this.readManifest(workingDir);
      const { n, file } = await writeCopyExclusively(
        dir,
        manifest.next,
        absolute,
        content
      );
      const copy = {
        n,
        path: absolute,
        file,
        bytes: typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength,
        lines: meta.lines,
        savedAt: Date.now(),
        tool: meta.tool,
        sessionId: meta.sessionId
      };
      manifest.next = n + 1;
      manifest.copies.push(copy);
      while (manifest.copies.length > RESTORE_COPY_CAP) {
        const dropped = manifest.copies.shift();
        if (dropped !== void 0) {
          await rm(join(dir, dropped.file), { force: true });
        }
      }
      await writeJsonAtomically(join(dir, MANIFEST_FILE), manifest);
      return copy;
    });
  }
  /** The newest saved copy for `absolute`, or null when none was ever taken (or it aged out). */
  async latestCopy(workingDir, absolute) {
    const manifest = await this.readManifest(workingDir);
    for (let i = manifest.copies.length - 1; i >= 0; i--) {
      const copy = manifest.copies[i];
      if (copy !== void 0 && copy.path === absolute) return copy;
    }
    return null;
  }
  async readCopy(workingDir, copy) {
    return readFile(join(this.copiesDir(workingDir), copy.file));
  }
  /** Every copy the working directory still holds, oldest first. */
  async listCopies(workingDir) {
    return (await this.readManifest(workingDir)).copies;
  }
  async readManifest(workingDir) {
    try {
      const raw = await readFile(
        join(this.copiesDir(workingDir), MANIFEST_FILE),
        "utf8"
      );
      return normalizeManifest(JSON.parse(raw), workingDir);
    } catch {
      return emptyManifest(workingDir);
    }
  }
  async readSession(sessionId) {
    try {
      const raw = await readFile(this.sessionFile(sessionId), "utf8");
      return normalizeSession(JSON.parse(raw));
    } catch {
      return { version: 1, created: [] };
    }
  }
  /**
   * Run `fn` after every earlier call made under `key` has settled. The
   * workers of one fan-out replace files at the same time into the same
   * manifest; two unserialised read-modify-writes would each see `next`
   * = 5 and one would lose its entry.
   */
  async serialised(key, fn) {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.then(fn);
    const settled = run.then(
      () => void 0,
      () => void 0
    );
    this.chains.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    }
  }
}
export {
  FileRestoreStore,
  RESTORE_COPY_CAP,
  RESTORE_MAX_BYTES,
  restoreKey2 as restoreKey
};
