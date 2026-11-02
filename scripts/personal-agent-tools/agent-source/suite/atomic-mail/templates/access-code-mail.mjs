import { MONO, SCREEN, esc, renderMailShell } from "./mail-shell.mjs";
function renderAccessCodeMail(input) {
  const digits = [...input.code];
  const cells = digits.map(
    (d) => `<td style="width:44px;height:52px;text-align:center;vertical-align:middle;font-family:${MONO};font-size:34px;font-weight:bold;line-height:52px;color:${SCREEN.green};border:2px solid ${SCREEN.bezel};background:${SCREEN.bg}">${esc(d)}</td>`
  ).join(`<td style="width:8px;font-size:1px;line-height:1px">&nbsp;</td>`);
  const codeTable = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:separate;margin:6px auto"><tr>${cells}</tr></table>`;
  const subject = `\u25B6 ACCESS CODE ${input.code} \u2014 Atomic Agent`;
  const text = [
    "ATOMIC AGENT \u2014 TRANSMISSION IDENT",
    "",
    "ACCESS CODE",
    "",
    `   ${digits.join("  ")}`,
    "",
    `> type it into Integrations \u2192 Atomic Mail within ${input.expiresInMinutes} minutes`,
    "> after that your agent can reach you at this address",
    "",
    "IDENTIFY, COMMANDER",
    "",
    "\u25B6 Didn't ask for this? Ignore it \u2014 nothing changes without the code.",
    "",
    `sent by ${input.from} \xB7 reply to talk to your agent`
  ].join("\n");
  const html = renderMailShell({
    transmission: "TRANSMISSION IDENT",
    banner: "ACCESS CODE",
    bannerColor: SCREEN.green,
    readout: [
      codeTable,
      `<span style="color:${SCREEN.green}">&gt;</span> type it into Integrations \u2192 Atomic Mail within ${input.expiresInMinutes} minutes`,
      `<span style="color:${SCREEN.green}">&gt;</span> after that your agent can reach you at this address`
    ],
    status: "IDENTIFY, COMMANDER",
    cta: "Didn't ask for this? Ignore it \u2014 nothing changes without the code.",
    from: input.from,
    title: `Access code ${input.code}`
  });
  return { subject, text, html };
}
export {
  renderAccessCodeMail
};
