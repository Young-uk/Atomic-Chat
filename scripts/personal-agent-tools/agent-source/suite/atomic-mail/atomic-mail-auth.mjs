import { scrypt } from "node:crypto";
const ATOMIC_MAIL_AUTH_URL = "https://auth.atomicmail.ai";
const ATOMIC_MAIL_API_URL = "https://api.atomicmail.ai";
const ATOMIC_MAIL_DOMAIN = "atomicmail.ai";
const POW_SALT_HEX = "0b980734412c292d6549110276b604ab1dea4883bd460d77d1b984adf8bca083";
const SCRYPT = { N: 16384, r: 8, p: 1 };
const POW_HASH_BYTES = 64;
const SESSION_SAFETY_MARGIN_MS = 6e4;
const CAPABILITY_SAFETY_MARGIN_MS = 2e4;
const REQUEST_TIMEOUT_MS = 3e4;
class AtomicMailError extends Error {
  constructor(message, status, hint) {
    super(hint ? `${message} \u2014 ${hint}` : message);
    this.status = status;
    this.hint = hint;
    this.name = "AtomicMailError";
  }
}
function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  if (!part) throw new AtomicMailError("malformed token", 0);
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
}
function jwtExpiryMs(jwt) {
  const exp = decodeJwtPayload(jwt).exp;
  return typeof exp === "number" ? exp * 1e3 : 0;
}
function hasLeadingZeroBits(hash, bits) {
  if (bits > hash.length * 8) return false;
  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i += 1) if (hash[i] !== 0) return false;
  const rest = bits % 8;
  if (rest === 0) return true;
  const mask = 255 << 8 - rest & 255;
  return ((hash[fullBytes] ?? 255) & mask) === 0;
}
function scryptHash(data) {
  return new Promise((resolve, reject) => {
    scrypt(
      Buffer.from(data, "utf-8"),
      Buffer.from(POW_SALT_HEX, "utf-8"),
      POW_HASH_BYTES,
      SCRYPT,
      (err, key) => err ? reject(err) : resolve(new Uint8Array(key))
    );
  });
}
async function solveProofOfWork(challenge, difficulty, onProgress) {
  for (let nonce = 0; ; nonce += 1) {
    const digest = await scryptHash(`${challenge}:${nonce}`);
    if (hasLeadingZeroBits(digest, difficulty)) {
      return {
        powHex: Buffer.from(digest).toString("hex"),
        nonce: String(nonce)
      };
    }
    if (onProgress && nonce % 64 === 0) onProgress(nonce);
  }
}
function readBearer(res) {
  const raw = res.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  if (!m)
    throw new AtomicMailError("no bearer token in the response", res.status);
  return m[1];
}
async function failFrom(res, what) {
  let hint;
  try {
    const body = await res.json();
    if (typeof body.error === "string") hint = body.error;
    else hint = body.error?.hint ?? body.error?.message;
  } catch {
  }
  return new AtomicMailError(
    `${what} failed: HTTP ${res.status}`,
    res.status,
    hint
  );
}
export {
  ATOMIC_MAIL_API_URL,
  ATOMIC_MAIL_AUTH_URL,
  ATOMIC_MAIL_DOMAIN,
  AtomicMailError,
  CAPABILITY_SAFETY_MARGIN_MS,
  POW_SALT_HEX,
  REQUEST_TIMEOUT_MS,
  SESSION_SAFETY_MARGIN_MS,
  decodeJwtPayload,
  failFrom,
  hasLeadingZeroBits,
  jwtExpiryMs,
  readBearer,
  scryptHash,
  solveProofOfWork
};
