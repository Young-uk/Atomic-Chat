import {
  requireApproval
} from "../../../approval/dangerous-tool.mjs";
import {
  categorizeFsMutation
} from "./fs-approval-scope.mjs";
async function requireFsApproval(options, request, signal) {
  const category = await categorizeFsMutation(request.kind, request.paths, {
    workingDir: request.workingDir,
    ...request.trustConfigPaths !== void 0 ? { trustConfigPaths: request.trustConfigPaths } : {}
  });
  const targetPaths = request.targetPaths ?? [];
  if (category !== "trust_config" && options.approvals.fanoutScopes.allows(request.sessionId, request.paths) && !(options.approvals.hasDeclinedTarget?.({
    sessionId: request.sessionId,
    tool: request.tool,
    category,
    targetPaths: [...targetPaths]
  }) ?? false)) {
    return { category };
  }
  const outcome = await requireApproval(
    options,
    {
      sessionId: request.sessionId,
      tool: request.tool,
      category,
      reason: request.reason,
      ...request.preview !== void 0 ? { preview: request.preview } : {},
      ...request.affectedResources !== void 0 ? { affectedResources: request.affectedResources } : {},
      ...request.redirectablePath !== void 0 ? { redirectablePath: request.redirectablePath } : {},
      targetPaths
    },
    signal
  );
  return {
    category,
    ...outcome.pathOverride !== void 0 ? { pathOverride: outcome.pathOverride } : {}
  };
}
export {
  requireFsApproval
};
