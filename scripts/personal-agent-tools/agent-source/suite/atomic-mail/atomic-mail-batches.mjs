import { AtomicMailError } from "./atomic-mail-auth.mjs";
function buildSendBatch(accountId, from, draftsMailboxId, mail, identityId = null) {
  const bodyValues = {
    t: { value: mail.text }
  };
  if (mail.html) bodyValues.h = { value: mail.html };
  return [
    [
      "Email/set",
      {
        accountId,
        create: {
          d1: {
            mailboxIds: { [draftsMailboxId]: true },
            from: [{ email: from, name: "Atomic Agent" }],
            to: [{ email: mail.to }],
            subject: mail.subject,
            textBody: [{ partId: "t", type: "text/plain" }],
            ...mail.html ? { htmlBody: [{ partId: "h", type: "text/html" }] } : {},
            bodyValues,
            keywords: { $draft: true, $seen: true }
          }
        }
      },
      "c0"
    ],
    [
      "EmailSubmission/set",
      {
        accountId,
        create: {
          s1: {
            emailId: "#d1",
            ...identityId ? { identityId } : {},
            envelope: {
              mailFrom: { email: from },
              rcptTo: [{ email: mail.to }]
            }
          }
        },
        onSuccessUpdateEmail: { "#s1": { "keywords/$draft": null } }
      },
      "c1"
    ]
  ];
}
function parseSendResult(responses) {
  const typed = responses;
  const draft = typed.find(([name]) => name === "Email/set")?.[1];
  const draftWhy = draft?.notCreated?.d1;
  if (draftWhy) {
    throw new AtomicMailError(
      "the draft was not accepted",
      0,
      draftWhy.description ?? draftWhy.type
    );
  }
  const submission = typed.find(
    ([name]) => name === "EmailSubmission/set"
  )?.[1];
  const id = submission?.created?.s1?.id;
  if (!id) {
    const why = submission?.notCreated?.s1;
    throw new AtomicMailError(
      "send was not accepted",
      0,
      why?.description ?? why?.type
    );
  }
  return id;
}
function buildInboxBatch(accountId, mailboxId, limit) {
  return [
    [
      "Email/query",
      {
        accountId,
        filter: { inMailbox: mailboxId },
        sort: [{ property: "receivedAt", isAscending: false }],
        limit
      },
      "q"
    ],
    [
      "Email/get",
      {
        accountId,
        "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
        properties: [
          "id",
          "from",
          "subject",
          "receivedAt",
          "preview",
          "keywords"
        ]
      },
      "g"
    ]
  ];
}
function parseInboxList(responses) {
  const got = responses.find(
    ([name]) => name === "Email/get"
  )?.[1];
  return (got?.list ?? []).map((m) => {
    const from = m.from?.[0];
    const keywords = m.keywords ?? {};
    return {
      id: String(m.id ?? ""),
      from: from?.name ? `${from.name} <${from.email ?? ""}>` : from?.email ?? "",
      subject: String(m.subject ?? ""),
      receivedAt: String(m.receivedAt ?? ""),
      preview: String(m.preview ?? ""),
      unread: keywords.$seen !== true
    };
  });
}
export {
  buildInboxBatch,
  buildSendBatch,
  parseInboxList,
  parseSendResult
};
