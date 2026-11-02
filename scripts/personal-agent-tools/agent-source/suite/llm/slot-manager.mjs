import { createHash } from "node:crypto";
import { getConfig } from "../config/index.mjs";
function resolveSlotId(source) {
  return typeof source === "function" ? source() : source;
}
const DEFAULT_SLOT_COUNT = 1;
class SlotManager {
  assignments = /* @__PURE__ */ new Map();
  slotCount;
  slotPool;
  reservedReflectionSlot = null;
  /** Whether a `/props` answer has ever sized the pool — see `observedPoolSize`. */
  observed = false;
  constructor(slotCount = DEFAULT_SLOT_COUNT) {
    if (slotCount <= 0) {
      throw new Error("slotCount must be positive");
    }
    this.slotCount = slotCount;
    this.slotPool = Array.from({ length: slotCount }, (_, i) => i);
  }
  /** Slot count the pool is currently sized for. */
  getSlotCount() {
    return this.slotCount;
  }
  /**
   * Slots sessions can run on: the configured count minus the reflection
   * reservation. This — not `getSlotCount()` — is how many turns can run
   * against the local server without two of them sharing a slot and
   * evicting each other's KV cache; the fusion fan-out sizes its
   * concurrent worker count from it.
   */
  poolSize() {
    return this.slotPool.length;
  }
  /**
   * `poolSize()` once the server has been asked, `null` before. The
   * constructor's count is a guess (one slot, or the configured
   * `--parallel`); `resize()` is called from a `/props` answer, and only
   * a number the server itself reported is one the `### fusion` machine
   * facts may state — a guessed slot count is a number the model plans
   * against.
   */
  observedPoolSize() {
    return this.observed ? this.poolSize() : null;
  }
  /**
   * Re-size the pool to the server's actual slot count, discovered from a
   * later `/props` probe. No-op when the count is unchanged, so the common
   * refresh path costs nothing and never disturbs live cache affinity.
   *
   * On a real change every existing assignment is dropped: a session's
   * slot id may no longer exist, and the server-side KV for it is not
   * where we think it is either way. The next `acquire` comes back
   * pending, so the session's next request lets the server pick by
   * prefix similarity — which finds the old slot when it still exists.
   *
   * A reflection reservation that is still in range is preserved; one that
   * fell outside is released back so `reserveReflectionSlot()` can re-take
   * a valid slot. Call this between turns — `acquire` has no locking and
   * the single-active-turn-per-session invariant is what keeps it safe.
   */
  resize(slotCount) {
    if (slotCount <= 0) {
      throw new Error("slotCount must be positive");
    }
    this.observed = true;
    if (slotCount === this.slotCount) return;
    const reserved = this.reservedReflectionSlot !== null && this.reservedReflectionSlot < slotCount ? this.reservedReflectionSlot : null;
    this.slotCount = slotCount;
    this.assignments.clear();
    this.reservedReflectionSlot = reserved;
    this.slotPool = Array.from({ length: slotCount }, (_, i) => i).filter(
      (id) => id !== reserved
    );
    if (this.slotPool.length === 0) {
      this.reservedReflectionSlot = null;
      this.slotPool = [0];
    }
  }
  /**
   * The assignment a request should carry. A pinned session gets its slot
   * back whatever the prefix did — `cacheReused` says whether the prefix
   * is the one the slot was pinned under, and the stored hash follows the
   * prefix so the next step reports reuse again. A session without a pin
   * gets a pending assignment (`slotId: -1`); see `pin()`.
   */
  acquire(sessionId, stablePrefix) {
    const prefixHash = hashPrefix(stablePrefix);
    const existing = this.assignments.get(sessionId);
    if (existing) {
      const cacheReused = existing.prefixHash === prefixHash;
      if (!cacheReused) {
        this.assignments.set(sessionId, { ...existing, prefixHash });
      }
      return { ...existing, prefixHash, cacheReused };
    }
    return {
      slotId: -1,
      prefixHash,
      firstSeenAt: Date.now(),
      cacheReused: false,
      pending: true
    };
  }
  /**
   * Record the slot llama-server chose for a session's pending request.
   * The server's answer is the truth even when it names the reserved
   * reflection slot or an id above the pool the probe reported — the
   * prompt is in that slot now, and pointing anywhere else would be the
   * cold rebuild this exists to avoid. Negative ids (a server that did
   * not say) leave the session pending.
   */
  pin(sessionId, slotId, prefixHash) {
    if (!Number.isInteger(slotId) || slotId < 0) return;
    const existing = this.assignments.get(sessionId);
    if (existing && existing.slotId === slotId) {
      if (existing.prefixHash !== prefixHash) {
        this.assignments.set(sessionId, { ...existing, prefixHash });
      }
      return;
    }
    this.assignments.set(sessionId, {
      slotId,
      prefixHash,
      firstSeenAt: Date.now(),
      cacheReused: false,
      pending: false
    });
  }
  /** The pinned slot for a session, or `null` while it has none. */
  pinnedSlot(sessionId) {
    return this.assignments.get(sessionId)?.slotId ?? null;
  }
  release(sessionId) {
    this.assignments.delete(sessionId);
  }
  reset() {
    this.assignments.clear();
    this.slotPool = Array.from({ length: this.slotCount }, (_, i) => i);
    this.reservedReflectionSlot = null;
  }
  /**
   * Carve out a slot for the async reflection runner and the other side
   * calls (link generation, voting, distillation, the query rewriter).
   * The reserved slot leaves the pool `poolSize()` reports, so the fusion
   * fan-out never plans a worker onto it. It prefers a slot no session is
   * pinned to, so reserving late — after the pool was widened by the
   * first `/props` — does not take a slot a session's prompt is in.
   *
   * Returns `null` when only one slot is available: reserving the sole
   * slot would starve the agent loop, so the caller should fall back to
   * `slotId: -1` (no cache affinity) for the side call in that case —
   * `sideCallSlotId()` does exactly that. Idempotent — subsequent calls
   * return the slot reserved on the first call.
   */
  reserveReflectionSlot() {
    if (this.reservedReflectionSlot !== null) {
      return this.reservedReflectionSlot;
    }
    if (this.slotPool.length <= 1) {
      return null;
    }
    const pinned = new Set(
      [...this.assignments.values()].map((assignment) => assignment.slotId)
    );
    let index = this.slotPool.length - 1;
    for (let i = this.slotPool.length - 1; i >= 0; i -= 1) {
      if (!pinned.has(this.slotPool[i])) {
        index = i;
        break;
      }
    }
    const [reserved] = this.slotPool.splice(index, 1);
    this.reservedReflectionSlot = reserved;
    return reserved;
  }
  /**
   * Where a side call runs: the reserved reflection slot when the pool
   * has room for one, else `-1`. Resolved at call time so a runner built
   * before the managed daemon's `/props` widened the pool still lands on
   * the reservation once there is one.
   */
  sideCallSlotId() {
    return this.reserveReflectionSlot() ?? -1;
  }
}
function hashPrefix(input) {
  const config = getConfig();
  return createHash("sha256").update(config.agent.stablePrefixHashSalt).update("\n").update(input).digest("hex");
}
export {
  DEFAULT_SLOT_COUNT,
  SlotManager,
  hashPrefix,
  resolveSlotId
};
