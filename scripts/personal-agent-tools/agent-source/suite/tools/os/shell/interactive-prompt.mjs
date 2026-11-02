const TAIL_CHARS = 1500;
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/;
const DEVICE_CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/;
const PATTERNS = [
  {
    kind: "needs_input",
    re: /sudo: (?:a terminal is required|a password is required|no tty present)|sudo: \d+ incorrect password|\[sudo\] password for /i,
    need: "it runs with sudo and needs your computer password \u2014 run it in your own terminal",
    when: "exited"
  },
  {
    kind: "sign_in",
    re: /(?:one[- ]time code|device code|user code|enter (?:the |this )?code|verification (?:code|ur[il]))|\/login\/device\b|\/device\b.*\bcode\b/i,
    need: "it needs you to sign in: open the link and enter the code",
    when: "running"
  },
  {
    kind: "sign_in",
    re: /(?:authori[sz]|authenticat|sign[- ]?in|log[- ]?in|consent|oauth)[^\n]*(?:browser|https?:\/\/)|(?:browser|https?:\/\/)[^\n]*(?:authori[sz]|authenticat|sign[- ]?in|log[- ]?in|consent|oauth)|waiting for (?:the )?(?:authenti[cz]ation|authori[sz]ation|oauth|callback|sign[- ]?in|login|browser)/i,
    need: "it needs you to sign in in the browser it opened",
    when: "running"
  },
  {
    kind: "needs_input",
    re: /the input device is not a tty|not a tty|stdin is not a (?:tty|terminal)|inappropriate ioctl for device|must be run (?:from|in) a terminal|requires an interactive (?:terminal|shell)|no tty available|cannot prompt|non-?interactive mode/i,
    need: "it needs a real terminal to ask you something \u2014 run it in your own terminal",
    when: "exited"
  },
  {
    kind: "needs_input",
    re: /(?:password|passphrase|passcode|pin)(?: for [^\n:]{1,80})?:\s*$/i,
    need: "it asks for a password \u2014 run it in your own terminal",
    when: "both",
    lastLine: true
  },
  {
    kind: "needs_input",
    re: /(?:press (?:any key|enter|return)\b[^\n]*|\[(?:y\/n|yes\/no)\]\s*[?:]?\s*|\((?:y\/n|yes\/no)\)\s*[?:]?\s*|\?\s*)$/i,
    need: "it stopped at a question that needs your answer \u2014 pass a flag that answers it (e.g. --yes) if one fits, otherwise ask the user to run it in their own terminal",
    when: "running",
    lastLine: true
  }
];
function detectInteractivePrompt(output, state) {
  const tail = output.slice(-TAIL_CHARS).replace(/\r/g, "\n").trimEnd();
  if (tail.length === 0) return null;
  const lastLines = tail.split("\n").slice(-12).join("\n");
  for (const pattern of PATTERNS) {
    if (pattern.when !== "both" && pattern.when !== state) continue;
    const subject = pattern.lastLine === true ? lastLine(lastLines) : lastLines;
    if (!pattern.re.test(subject)) continue;
    const found = { kind: pattern.kind, need: pattern.need };
    if (pattern.kind === "sign_in") {
      const url = lastLines.match(URL_RE)?.[0];
      if (url !== void 0) found.url = url.replace(/[.,;:]+$/, "");
      const codeLine = lastLines.split("\n").find((line) => /code/i.test(line) && DEVICE_CODE_RE.test(line));
      const code = codeLine?.match(DEVICE_CODE_RE)?.[1];
      if (code !== void 0) found.code = code;
    }
    return found;
  }
  return null;
}
function lastLine(text) {
  const lines = text.split("\n");
  return lines[lines.length - 1] ?? "";
}
function formatInteractiveHandoff(prompt, commandLine, outcome) {
  const parts = [`this step needs the user: ${prompt.need}`];
  if (prompt.url !== void 0) parts.push(`link: ${prompt.url}`);
  if (prompt.code !== void 0) parts.push(`code: ${prompt.code}`);
  if ("jobId" in outcome) {
    const { jobId } = outcome;
    parts.push(
      `the command is still waiting as job ${jobId} (kept) \u2014 reply with the link${prompt.code !== void 0 ? " and code" : ""} and ask the user to finish there, then os.shell.run {"wait": ${jobId}} to see it complete; do not start it again`
    );
  } else {
    parts.push(
      `the command ${outcome.ended === "stopped" ? "was stopped" : "failed"} \u2014 hand the user only this one step (\`${headOf(commandLine)}\`), keep doing every other step yourself, and continue once they confirm`
    );
  }
  return parts.join("; ");
}
function headOf(commandLine, max = 120) {
  const line = commandLine.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}
export {
  detectInteractivePrompt,
  formatInteractiveHandoff
};
