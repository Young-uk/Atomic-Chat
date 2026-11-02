const GITHUB_EXTRAHEADER_KEY = "http.https://github.com/.extraheader";
function githubAuthHeaderValue(token) {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString(
    "base64"
  );
  return `AUTHORIZATION: basic ${basic}`;
}
function githubAuthGitEnv(token) {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: GITHUB_EXTRAHEADER_KEY,
    GIT_CONFIG_VALUE_0: githubAuthHeaderValue(token)
  };
}
export {
  GITHUB_EXTRAHEADER_KEY,
  githubAuthGitEnv,
  githubAuthHeaderValue
};
