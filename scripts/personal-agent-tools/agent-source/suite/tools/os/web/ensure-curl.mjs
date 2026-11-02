function isCurlMissingError(err) {
  const code = err?.code;
  return code === "ENOENT";
}
class CurlUnavailableError extends Error {
  constructor() {
    super(
      "curl is required for HTTP/web tools but was not found on PATH. On Windows 10 1803+ curl.exe ships with the OS \u2014 update Windows, or install curl and ensure it is on PATH."
    );
    this.name = "CurlUnavailableError";
  }
}
export {
  CurlUnavailableError,
  isCurlMissingError
};
