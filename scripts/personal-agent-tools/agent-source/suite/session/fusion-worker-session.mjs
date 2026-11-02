import { randomUUID } from "node:crypto";
import { createEmptySessionState } from "./session-state.mjs";
const FUSION_WORKER_METADATA_KEY = "fusionWorker";
const FUSION_WORKER_ID_PREFIX = "s-w-";
function createFusionWorkerSession(input) {
  return createEmptySessionState({
    id: `${FUSION_WORKER_ID_PREFIX}${randomUUID()}`,
    workingDir: input.workingDir,
    metadata: { [FUSION_WORKER_METADATA_KEY]: { ...input.meta } }
  });
}
function readFusionWorkerMeta(metadata) {
  const raw = metadata?.[FUSION_WORKER_METADATA_KEY];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { parentSessionId, taskId } = raw;
  if (typeof parentSessionId !== "string" || parentSessionId.length === 0) {
    return null;
  }
  if (typeof taskId !== "string" || taskId.length === 0) return null;
  return { parentSessionId, taskId };
}
function isFusionWorkerSessionId(id) {
  return id.startsWith(FUSION_WORKER_ID_PREFIX);
}
export {
  FUSION_WORKER_ID_PREFIX,
  FUSION_WORKER_METADATA_KEY,
  createFusionWorkerSession,
  isFusionWorkerSessionId,
  readFusionWorkerMeta
};
