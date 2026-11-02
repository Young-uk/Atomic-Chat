import { isSecretEnvName } from "../sandbox/command-env.mjs";
const MIN_KNOWN_SECRET_LENGTH = 8;
const MARKER_PREFIX = "[redacted:";
function redactedMarker(label) {
  const safe = label.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 64) || "secret";
  return `${MARKER_PREFIX}${safe}]`;
}
const hasDigit = (s) => /\d/.test(s);
const hasLongRun = (s) => s.split("-").some((part) => part.length >= 16);
function shape(re, needle, label, accept = () => true) {
  const needles = typeof needle === "string" ? [needle] : needle;
  return {
    applies: (text) => needles.some((n) => text.includes(n)),
    apply: (text) => text.replace(
      re,
      (match) => accept(match) ? redactedMarker(typeof label === "string" ? label : label(match)) : match
    )
  };
}
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----(?:(?:\\r\\n|\\n|\r?\n)[ \t]*(?:[A-Za-z0-9+/=]{1,4096}|(?:Proc-Type|DEK-Info): [^\r\n\\]{0,200})?)*(?:(?:\\r\\n|\\n|\r?\n)[ \t]*)?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----)?/g;
const SHAPE_RULES = [
  // Anthropic (`sk-ant-api03-…`, `sk-ant-oat01-…`) and OpenRouter
  // (`sk-or-v1-…`) before the generic `sk-` shape that would also match.
  shape(/(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g, "sk-ant-", "anthropic-key", hasLongRun),
  shape(/(?<![A-Za-z0-9_-])sk-or-[A-Za-z0-9_-]{20,}/g, "sk-or-", "openrouter-key", hasLongRun),
  // OpenAI (`sk-proj-…`, `sk-svcacct-…`, classic `sk-…`) and the many
  // services that copied its shape (DeepSeek, Moonshot, …). A real key
  // has a digit and a long random run; `sk-` followed by short words is
  // a CSS class or a slug.
  shape(
    /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g,
    "sk-",
    (m) => /^sk-(?:proj|svcacct|admin)-/.test(m) ? "openai-key" : "api-key",
    (m) => hasDigit(m) && hasLongRun(m)
  ),
  shape(
    /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g,
    ["gh", "github_pat_"],
    "github-token"
  ),
  shape(/(?<![A-Za-z0-9_-])xox[abeoprs]-[A-Za-z0-9-]{10,}/g, "xox", "slack-token", hasDigit),
  // Fixed-length shapes are bounded on both sides by the base64
  // alphabet, so a run of an image's base64 that happens to contain
  // `AKIA` or `AIza` is not taken for a key.
  shape(/(?<![A-Za-z0-9+/])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9+/=])/g, ["AKIA", "ASIA"], "aws-access-key"),
  shape(/(?<![A-Za-z0-9+/_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, "AIza", "google-key"),
  shape(/(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,}(?![A-Za-z0-9_])/g, "hf_", "hf-token"),
  shape(
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    "eyJ",
    "jwt"
  ),
  {
    // `Authorization: Basic <base64>` — only after the header name, since
    // "Basic" is an ordinary word.
    applies: (text) => /authorization/i.test(text),
    apply: (text) => text.replace(
      /(\bauthorization["']?[ \t]*[:=][ \t]*["']?basic[ \t]+)[A-Za-z0-9+/]{8,}={0,2}/gi,
      (_m, head) => `${head}${redactedMarker("basic-auth")}`
    )
  },
  {
    // `Bearer <token>` anywhere: an echoed header, a curl line, a log.
    applies: (text) => /bearer/i.test(text),
    apply: (text) => text.replace(
      /\b((?:[Bb]earer|BEARER)[ \t]+)([A-Za-z0-9._~+/-]{16,}=*)/g,
      (match, head, token) => hasDigit(token) ? `${head}${redactedMarker("bearer-token")}` : match
    )
  },
  {
    // A `Cookie:` / `Set-Cookie:` header carries session credentials as
    // `name=value` pairs whose names say nothing; the pairs go. Only a
    // header that starts with a pair counts (`cookie: req.headers.cookie`
    // is code), and the value stops at a quote, a backslash (a
    // JSON-escaped `\r\n`) or the end of the line.
    applies: (text) => /cookie/i.test(text),
    apply: (text) => text.replace(
      /(\b(?:set-)?cookie[ \t]*:[ \t]*)[A-Za-z0-9!#$%&'*+^_`|~.-]{1,128}=[^;\r\n"\\]{1,4096}(?:;[^;\r\n"\\]{0,4096}){0,64}/gi,
      (_m, head) => `${head}${redactedMarker("cookie")}`
    )
  },
  {
    // `scheme://user:password@host` — the user name stays, the password goes.
    applies: (text) => text.includes("://") && text.includes("@"),
    apply: (text) => text.replace(
      /\b([A-Za-z][A-Za-z0-9+.-]{1,30}:\/\/)([^\s/:@?#]{0,256}):([^\s/@?#]{1,256})@/g,
      (match, scheme, user, password) => password.startsWith(MARKER_PREFIX) ? match : `${scheme}${user}:${redactedMarker("password")}@`
    )
  }
];
const STRONG_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH_KEY|COOKIE/;
const NOT_SECRET_NAME = /TOKENIZER|(?:^|_)(?:MAX|NUM|TOTAL|PROMPT|COMPLETION|INPUT|OUTPUT|CACHED|REASONING)_TOKENS?(?:_|$)|_(?:COUNT|LIMIT|TYPE|KIND|FORMAT|ID|URL|URI|PATH|FILE|DIR|NAME|LABEL|ENDPOINT|HEADER|ENV|ENV_VAR|SCOPE|SCOPES|STATUS|VERSION|EXPIRY|EXPIRES|EXPIRES_AT|EXPIRES_IN|EXPIRATION|TTL|LENGTH|PREFIX|HINT|HASH|DIGEST|SHA|CHECKSUM|FINGERPRINT|PLACEHOLDER|TITLE|MESSAGE|MSG|TEXT|DESCRIPTION|ERROR|TOOLTIP|CAPTION|EXPIRED|INVALID|REQUIRED|MISMATCH|PROMPT|HELP|BUTTON|LINK)$|^(?:FORGOT|SHOW|HIDE|ENTER)_/;
function normaliseName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[.-]+/g, "_").toUpperCase();
}
function secretNameStrength(name) {
  const normalised = normaliseName(name);
  if (NOT_SECRET_NAME.test(normalised)) return null;
  if (!isSecretEnvName(normalised)) return null;
  return STRONG_NAME.test(normalised) ? "strong" : "weak";
}
const LITERAL_WORDS = /^(?:true|false|null|none|nil|undefined|yes|no|on|off|enabled|disabled|required|optional|string|number|boolean|redacted|hidden|secret|password|changeme)$/i;
function looksLikeSecretValue(value, strength) {
  if (value.length < MIN_KNOWN_SECRET_LENGTH) return false;
  if (value.startsWith(MARKER_PREFIX) || value.includes(MARKER_PREFIX)) return false;
  if (/^[\d.,:_-]+$/.test(value)) return false;
  if (LITERAL_WORDS.test(value)) return false;
  if (/^(?:\$|%|\{\{|<)/.test(value)) return false;
  if (/^(?:\/|\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(value)) {
    return false;
  }
  if (/^(.)\1+$/.test(value)) return false;
  if (strength === "weak") {
    return value.length >= 16 && /[A-Za-z]/.test(value) && hasDigit(value) && !/[\s/.]/.test(value) && !/^[0-9a-f-]+$/i.test(value);
  }
  return true;
}
const ASSIGNMENT = /(?<![A-Za-z0-9_$])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,63})\1([ \t]*[:=][ \t]*)(?:"([^"\r\n]{1,512})"|'([^'\r\n]{1,512})'|([^\s"'`,;&<>(){}=?]{1,512}={0,3}))/g;
function looksLikeProse(value) {
  if ((value.match(/ /g) ?? []).length >= 2) return true;
  if (/[.!?\u2026](?:\s|$)|,\s/.test(value)) return true;
  if (/ /.test(value) && /^[A-Za-z' ]+$/.test(value)) return true;
  return /^[A-Z]?[a-z]+$/.test(value);
}
function looksLikeBareToken(value, next) {
  if (next === "(" || next === "[") return false;
  if (/[.()[\]:]/.test(value)) return false;
  if (/[A-Za-z]/.test(value) && hasDigit(value)) return true;
  return value.length >= 32 && /[a-z]/.test(value) && /[A-Z]/.test(value);
}
const ASSIGNMENT_RULE = {
  applies: (text) => text.includes("=") || text.includes(":"),
  apply: (text) => text.replace(
    ASSIGNMENT,
    (match, nameQuote, name, sep, doubleQuoted, singleQuoted, bare, offset, whole) => {
      const strength = secretNameStrength(name);
      if (strength === null) return match;
      const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
      const quoted = doubleQuoted !== void 0 || singleQuoted !== void 0;
      if (quoted ? looksLikeProse(value) : !looksLikeBareToken(value, whole.charAt(offset + match.length))) {
        return match;
      }
      if (quoted && strength === "weak" && /\s/.test(value)) return match;
      if (!looksLikeSecretValue(value, strength)) return match;
      const q = doubleQuoted !== void 0 ? '"' : singleQuoted !== void 0 ? "'" : "";
      return `${nameQuote}${name}${nameQuote}${sep}${q}${redactedMarker("secret")}${q}`;
    }
  )
};
function usableKnownValue(value) {
  if (!looksLikeSecretValue(value, "strong")) return false;
  return hasDigit(value) || /[a-z]/.test(value) && /[A-Z]/.test(value) || /[^A-Za-z0-9_-]/.test(value);
}
function usableKnownSecrets(known) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const secret of known) {
    const value = secret.value.trim();
    if (seen.has(value)) continue;
    if (!usableKnownValue(value)) continue;
    seen.add(value);
    out.push({ label: secret.label, value });
  }
  return out.sort((a, b) => b.value.length - a.value.length);
}
function maskSecrets(text, known = []) {
  if (text.length < MIN_KNOWN_SECRET_LENGTH) return text;
  let out = text;
  if (out.includes("PRIVATE KEY-----")) {
    out = out.replace(PEM_PRIVATE_KEY, redactedMarker("private-key"));
  }
  for (const secret of usableKnownSecrets(known)) {
    if (out.includes(secret.value)) {
      out = out.split(secret.value).join(redactedMarker(secret.label));
    }
  }
  for (const rule of SHAPE_RULES) {
    if (rule.applies(out)) out = rule.apply(out);
  }
  if (ASSIGNMENT_RULE.applies(out)) out = ASSIGNMENT_RULE.apply(out);
  return out;
}
function knownSecretsFromEnv(env = process.env) {
  const out = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length < MIN_KNOWN_SECRET_LENGTH) continue;
    if (!isSecretEnvName(name)) continue;
    out.push({ label: name, value });
  }
  return out;
}
export {
  MIN_KNOWN_SECRET_LENGTH,
  knownSecretsFromEnv,
  maskSecrets,
  redactedMarker
};
