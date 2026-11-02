/**
 * Atomic Mail — the agent's own `@atomicmail.ai` inbox, registered with
 * a proof-of-work instead of a human. See README.md.
 */
export {
  ATOMIC_MAIL_API_URL,
  ATOMIC_MAIL_AUTH_URL,
  ATOMIC_MAIL_DOMAIN,
  AtomicMailClient,
  AtomicMailError,
  decodeJwtPayload,
  solveProofOfWork,
  type AtomicMailClientOptions,
  type AtomicMailRegistration,
  type AtomicMailSession,
  type InboxMessage,
  type SendMailInput,
} from "./atomic-mail-client.mjs";
export {
  ATOMIC_MAIL_API_KEY_KEY,
  persistAtomicMailConfig,
  readAtomicMailApiKey,
  readCachedSession,
  resolveSessionPath,
  writeAtomicMailApiKey,
  writeCachedSession,
} from "./atomic-mail-store.mjs";
export {
  AtomicMailService,
  CODE_TTL_MINUTES,
  type AtomicMailReadiness,
  type AtomicMailServiceOptions,
} from "./atomic-mail-service.mjs";
export {
  renderDownloadMail,
  type DownloadMailInput,
  type RenderedMail,
} from "./templates/download-mail.mjs";
export {
  renderAccessCodeMail,
  type AccessCodeMailInput,
} from "./templates/access-code-mail.mjs";
