const SUBSCRIPTION_CLI_KIND = "subscription-cli";
function usesExternalCliAuth(entry) {
  return entry.kind === SUBSCRIPTION_CLI_KIND && Boolean(entry.subscriptionCli?.cli);
}
export {
  SUBSCRIPTION_CLI_KIND,
  usesExternalCliAuth
};
