const CLOUD_SUBCALL_MAX_TOKENS = 2048;
function buildCloudSubcallRequest(params) {
  return {
    prompt: params.prompt,
    sessionId: params.sessionId,
    maxTokens: params.maxTokens ?? CLOUD_SUBCALL_MAX_TOKENS,
    tools: [
      {
        type: "function",
        function: {
          name: params.emitFunctionName,
          description: params.description ?? "Emit structured output",
          parameters: params.argsSchema
        }
      }
    ],
    toolChoice: "auto",
    parallelToolCalls: false
  };
}
function isCloudSubcallTransport(transport) {
  return transport === "native_tools";
}
export {
  CLOUD_SUBCALL_MAX_TOKENS,
  buildCloudSubcallRequest,
  isCloudSubcallTransport
};
