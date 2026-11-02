import {
  ATOMIC_MAIL_API_URL,
  ATOMIC_MAIL_AUTH_URL,
  ATOMIC_MAIL_DOMAIN,
  AtomicMailError,
  CAPABILITY_SAFETY_MARGIN_MS,
  REQUEST_TIMEOUT_MS,
  SESSION_SAFETY_MARGIN_MS,
  decodeJwtPayload,
  failFrom,
  jwtExpiryMs,
  readBearer,
  solveProofOfWork
} from "./atomic-mail-auth.mjs";
import {
  buildInboxBatch,
  buildSendBatch,
  parseInboxList,
  parseSendResult
} from "./atomic-mail-batches.mjs";
import {
  ATOMIC_MAIL_API_URL as ATOMIC_MAIL_API_URL2,
  ATOMIC_MAIL_AUTH_URL as ATOMIC_MAIL_AUTH_URL2,
  ATOMIC_MAIL_DOMAIN as ATOMIC_MAIL_DOMAIN2,
  AtomicMailError as AtomicMailError2,
  decodeJwtPayload as decodeJwtPayload2,
  solveProofOfWork as solveProofOfWork2
} from "./atomic-mail-auth.mjs";
function requestSignal(caller) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return caller ? AbortSignal.any([timeout, caller]) : timeout;
}
class AtomicMailClient {
  authUrl;
  apiUrl;
  call;
  pow;
  now;
  jmap = null;
  constructor(opts = {}) {
    this.authUrl = (opts.authUrl ?? ATOMIC_MAIL_AUTH_URL).replace(/\/+$/, "");
    this.apiUrl = (opts.apiUrl ?? ATOMIC_MAIL_API_URL).replace(/\/+$/, "");
    this.call = opts.fetchImpl ?? fetch;
    this.pow = opts.solvePow ?? ((c, d, p) => solveProofOfWork(c, d, p));
    this.now = opts.now ?? Date.now;
  }
  async post(url, init = {}) {
    return this.call(url, {
      method: "POST",
      headers: {
        ...init.jwt ? { authorization: `Bearer ${init.jwt}` } : {},
        ...init.body !== void 0 ? { "content-type": "application/json" } : {}
      },
      ...init.body !== void 0 ? { body: JSON.stringify(init.body) } : {},
      signal: requestSignal(init.signal)
    });
  }
  /** Challenge → proof-of-work → session. `credential` is a username (signup) or an API key (login). */
  async openSession(credential, onProgress) {
    const challengeRes = await this.post(`${this.authUrl}/api/v1/challenge`);
    if (!challengeRes.ok) throw await failFrom(challengeRes, "challenge");
    const challengeJwt = readBearer(challengeRes);
    const payload = decodeJwtPayload(challengeJwt);
    const challenge = String(payload.jti ?? "");
    const difficulty = Number(payload.difficulty ?? 0);
    if (!challenge)
      throw new AtomicMailError("challenge token carries no jti", 0);
    const solved = await this.pow(challenge, difficulty, onProgress);
    const sessionRes = await this.post(`${this.authUrl}/api/v1/session`, {
      jwt: challengeJwt,
      body: { powHex: solved.powHex, nonce: solved.nonce, ...credential }
    });
    if (!sessionRes.ok) throw await failFrom(sessionRes, "session");
    const sessionJwt = readBearer(sessionRes);
    let apiKey = null;
    try {
      const body = await sessionRes.json();
      if (typeof body.apiKey === "string") apiKey = body.apiKey;
    } catch {
    }
    return { sessionJwt, apiKey };
  }
  /**
   * Create the agent's inbox. `username` is 5–21 characters and becomes
   * `<username>@atomicmail.ai`. The API key comes back exactly once.
   */
  async register(username, onProgress) {
    if (!/^[a-z0-9][a-z0-9.-]{3,19}[a-z0-9]$/.test(username)) {
      throw new AtomicMailError(
        "username must be 5\u201321 characters: letters, digits, dots, dashes",
        0
      );
    }
    const { sessionJwt, apiKey } = await this.openSession(
      { username },
      onProgress
    );
    if (!apiKey)
      throw new AtomicMailError("registration returned no API key", 0);
    const session = { sessionJwt, sessionExpiresAt: jwtExpiryMs(sessionJwt) };
    const ctx = await this.context(session);
    return {
      address: ctx.address,
      accountId: ctx.accountId,
      apiKey,
      ...session
    };
  }
  /** Log in with a stored API key. Costs one proof-of-work; cache the session. */
  async login(apiKey) {
    const { sessionJwt } = await this.openSession({ apiKey });
    return { sessionJwt, sessionExpiresAt: jwtExpiryMs(sessionJwt) };
  }
  static sessionIsFresh(session, now = Date.now()) {
    return session !== null && now < session.sessionExpiresAt - SESSION_SAFETY_MARGIN_MS;
  }
  /** Capability token + JMAP session discovery, cached for the capability's life. */
  async context(session) {
    if (this.jmap && this.now() < this.jmap.capabilityExpiresAt - CAPABILITY_SAFETY_MARGIN_MS) {
      return this.jmap;
    }
    const capRes = await this.post(`${this.authUrl}/api/v1/capability`, {
      jwt: session.sessionJwt
    });
    if (!capRes.ok) throw await failFrom(capRes, "capability");
    const capabilityJwt = readBearer(capRes);
    const wellKnown = await this.call(`${this.apiUrl}/.well-known/jmap`, {
      headers: { authorization: `Bearer ${capabilityJwt}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!wellKnown.ok) throw await failFrom(wellKnown, "JMAP discovery");
    const s = await wellKnown.json();
    const accountId = s.primaryAccounts?.["urn:ietf:params:jmap:mail"];
    if (!s.apiUrl || !accountId)
      throw new AtomicMailError("JMAP session lacks apiUrl/accountId", 0);
    const raw = s.username ?? s.accounts?.[accountId]?.name ?? "";
    const address = raw.includes("@") ? raw : `${raw}@${ATOMIC_MAIL_DOMAIN}`;
    this.jmap = {
      capabilityJwt,
      capabilityExpiresAt: jwtExpiryMs(capabilityJwt),
      accountId,
      apiUrl: s.apiUrl.startsWith("http") ? s.apiUrl : `${this.apiUrl}${s.apiUrl}`,
      address,
      // Carried over: identities and mailbox ids outlive a capability.
      identityId: this.jmap?.identityId ?? null,
      draftsMailboxId: this.jmap?.draftsMailboxId ?? null
    };
    return this.jmap;
  }
  /** Drop every cached token; the next call re-discovers. */
  resetContext() {
    this.jmap = null;
  }
  /** The sending identity for `from`, looked up once per client. */
  async identityId(session) {
    const ctx = await this.context(session);
    if (ctx.identityId) return ctx.identityId;
    try {
      const [[, got]] = await this.jmapCall(session, [
        ["Identity/get", { accountId: ctx.accountId }, "i"]
      ]);
      const list = got.list ?? [];
      const match = list.find((i) => i.email === ctx.address) ?? list[0];
      ctx.identityId = match?.id ?? null;
    } catch {
      ctx.identityId = null;
    }
    return ctx.identityId;
  }
  async jmapCall(session, methodCalls, signal) {
    const ctx = await this.context(session);
    const res = await this.post(ctx.apiUrl, {
      jwt: ctx.capabilityJwt,
      ...signal ? { signal } : {},
      body: {
        using: [
          "urn:ietf:params:jmap:core",
          "urn:ietf:params:jmap:mail",
          "urn:ietf:params:jmap:submission"
        ],
        methodCalls
      }
    });
    if (!res.ok) throw await failFrom(res, "JMAP request");
    const body = await res.json();
    const responses = body.methodResponses ?? [];
    for (const r of responses) {
      const [name, args] = r;
      if (name === "error") {
        throw new AtomicMailError(
          `JMAP ${String(args.type ?? "error")}`,
          0,
          typeof args.description === "string" ? args.description : void 0
        );
      }
    }
    return responses;
  }
  /** The address this session belongs to. */
  async address(session) {
    return (await this.context(session)).address;
  }
  async mailboxId(session, role) {
    const ctx = await this.context(session);
    const [[, q]] = await this.jmapCall(session, [
      ["Mailbox/query", { accountId: ctx.accountId, filter: { role } }, "q"]
    ]);
    const id = q.ids?.[0];
    if (!id) throw new AtomicMailError(`no ${role} mailbox`, 0);
    return id;
  }
  /** Draft + submit in one batch. Resolves to the submission id. */
  async send(session, mail, opts) {
    const ctx = await this.context(session);
    if (!ctx.draftsMailboxId) {
      ctx.draftsMailboxId = await this.mailboxId(session, "drafts").catch(
        () => this.mailboxId(session, "inbox")
      );
    }
    const identityId = await this.identityId(session);
    const responses = await this.jmapCall(
      session,
      buildSendBatch(
        ctx.accountId,
        ctx.address,
        ctx.draftsMailboxId,
        mail,
        identityId
      ),
      opts?.signal
    );
    return parseSendResult(responses);
  }
  /** The newest `limit` inbox messages, newest first. */
  async listInbox(session, limit = 20, opts) {
    const ctx = await this.context(session);
    const inbox = await this.mailboxId(session, "inbox");
    return parseInboxList(
      await this.jmapCall(
        session,
        buildInboxBatch(ctx.accountId, inbox, limit),
        opts?.signal
      )
    );
  }
}
export {
  ATOMIC_MAIL_API_URL2 as ATOMIC_MAIL_API_URL,
  ATOMIC_MAIL_AUTH_URL2 as ATOMIC_MAIL_AUTH_URL,
  ATOMIC_MAIL_DOMAIN2 as ATOMIC_MAIL_DOMAIN,
  AtomicMailClient,
  AtomicMailError2 as AtomicMailError,
  decodeJwtPayload2 as decodeJwtPayload,
  solveProofOfWork2 as solveProofOfWork
};
