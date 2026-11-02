class ApprovalDeniedError extends Error {
  constructor(tool, reason, options = {}) {
    const byUser = options.byUser ?? false;
    const declinedEarlier = options.declinedEarlier ?? false;
    super(describeApprovalDenial(tool, reason, byUser, declinedEarlier));
    this.tool = tool;
    this.reason = reason;
    this.name = "ApprovalDeniedError";
    this.byUser = byUser;
    this.declinedEarlier = declinedEarlier;
  }
  byUser;
  /** See `ApprovalDecision.declinedEarlier`. */
  declinedEarlier;
}
function describeApprovalDenial(tool, reason, byUser, declinedEarlier = false) {
  const words = reason?.trim() ?? "";
  if (declinedEarlier) {
    return `${tool} was not run: the user already declined ${words || "it"} earlier in this turn, so it was not asked again. Do not try it again or another way; tell the user it was not done and ask what they would like instead.`;
  }
  if (!byUser) {
    return `${tool} was not run: refused without a decision from the user` + (words ? `. Reason: ${words}` : ".");
  }
  const decision = "This was their decision, not an error or a policy block.";
  if (words) {
    return `The user declined this ${tool} call. ${decision} Do not run the same call again; go by what they said. The user said: ${words}`;
  }
  return `The user declined this ${tool} call (they pressed Deny). ${decision} Do not retry it or try another way to do the same thing; tell the user it was not done and ask what they would like instead.`;
}
async function requireApproval(options, prompt, signal) {
  if (!options.approvalRequired) return {};
  const decision = await options.approvals.request(
    {
      sessionId: prompt.sessionId,
      tool: prompt.tool,
      category: prompt.category,
      reason: prompt.reason,
      ...prompt.preview !== void 0 ? { preview: prompt.preview } : {},
      ...prompt.affectedResources !== void 0 ? { affectedResources: prompt.affectedResources } : {},
      ...prompt.commandShape !== void 0 ? { commandShape: prompt.commandShape } : {},
      ...prompt.redirectablePath !== void 0 ? { redirectablePath: prompt.redirectablePath } : {},
      ...prompt.targetPaths !== void 0 && prompt.targetPaths.length > 0 ? { targetPaths: [...prompt.targetPaths] } : {}
    },
    { signal }
  );
  if (!decision.approved) {
    throw new ApprovalDeniedError(prompt.tool, decision.reason, {
      byUser: decision.automatic !== true,
      declinedEarlier: decision.declinedEarlier === true
    });
  }
  if (prompt.redirectablePath === void 0 || decision.pathOverride === void 0) {
    return {};
  }
  return { pathOverride: decision.pathOverride };
}
export {
  ApprovalDeniedError,
  describeApprovalDenial,
  requireApproval
};
