const REVOKE_BEST_EFFORT_FLAG = "--ssl-revoke-best-effort";
const NO_REVOKE_FLAG = "--ssl-no-revoke";
const CURL_EXIT_FAILED_INIT = 2;
let revocationFlag = REVOKE_BEST_EFFORT_FLAG;
async function runCurl(runCommand, args, options, seams = {}) {
  const platform = seams.platform ?? process.platform;
  if (platform !== "win32") return runCommand("curl", args, options);
  const flag = revocationFlag;
  const result = await runCommand("curl", [flag, ...args], options);
  if (flag !== REVOKE_BEST_EFFORT_FLAG || !isUnknownOption(result, flag)) {
    return result;
  }
  revocationFlag = NO_REVOKE_FLAG;
  return runCommand("curl", [NO_REVOKE_FLAG, ...args], options);
}
function isUnknownOption(result, flag) {
  return result.exitCode === CURL_EXIT_FAILED_INIT && result.stderr.includes(flag);
}
const REVOCATION_FAILURE = /CRYPT_E_(?:REVOCATION_OFFLINE|NO_REVOCATION_CHECK)|0x8009201[23]/i;
function explainCurlStderr(stderr) {
  if (!REVOCATION_FAILURE.test(stderr)) return stderr;
  return `Windows could not check whether the site's certificate was revoked: the certificate revocation server is unreachable (common behind proxies, VPNs and filtered networks). curl said: ${stderr}`;
}
function resetCurlRevocationFlagForTests() {
  revocationFlag = REVOKE_BEST_EFFORT_FLAG;
}
export {
  NO_REVOKE_FLAG,
  REVOKE_BEST_EFFORT_FLAG,
  explainCurlStderr,
  resetCurlRevocationFlagForTests,
  runCurl
};
