const CHALLENGE_MARKERS = [
  // Cloudflare
  "just a moment...",
  "checking your browser before accessing",
  "attention required! | cloudflare",
  "cf-browser-verification",
  "cf_chl_opt",
  "/cdn-cgi/challenge-platform/",
  "enable javascript and cookies to continue",
  // Akamai
  "reference #18.",
  "access denied | akamai",
  // PerimeterX / HUMAN
  "px-captcha",
  "please verify you are a human",
  // Imperva / Incapsula
  "incapsula incident id",
  "request unsuccessful. incapsula",
  // Generic
  "ddos protection by",
  "verifying you are human",
  "captcha-delivery.com"
];
const SCAN_BYTES = 4096;
const CHALLENGE_STATUSES = /* @__PURE__ */ new Set([200, 202, 403, 429, 503]);
function detectChallenge(input) {
  if (!CHALLENGE_STATUSES.has(input.status)) {
    return { challenged: false, marker: null };
  }
  const type = input.contentType.toLowerCase();
  if (type.length > 0 && !type.includes("html")) {
    return { challenged: false, marker: null };
  }
  const head = input.body.slice(0, SCAN_BYTES).toLowerCase();
  for (const marker of CHALLENGE_MARKERS) {
    if (head.includes(marker)) return { challenged: true, marker };
  }
  return { challenged: false, marker: null };
}
function describeChallenge(url, status, marker) {
  return `${url} answered with a bot-protection challenge (HTTP ${status}, matched "${marker}") rather than the page. This is a JavaScript wall and os.web.fetch cannot pass it. Open the page with browser.navigate and read it with browser.read_aria instead; do not re-fetch this URL.`;
}
export {
  describeChallenge,
  detectChallenge
};
