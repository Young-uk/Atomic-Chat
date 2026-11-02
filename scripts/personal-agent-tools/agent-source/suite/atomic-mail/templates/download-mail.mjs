import { SCREEN, esc, renderBar, renderMailShell } from "./mail-shell.mjs";
function formatBytes(bytes) {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "\u2014";
  const minutes = Math.round(ms / 6e4);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
function modelName(job) {
  return job.label.replace(/\s*\((gguf|mmproj)\)\s*$/i, "");
}
function transmissionCode(job) {
  let h = 0;
  for (const ch of job.id) h = h * 31 + ch.charCodeAt(0) >>> 0;
  return `0x${(h % 65535).toString(16).toUpperCase().padStart(4, "0")}`;
}
function quant(job) {
  const m = /\b(Q\d[A-Z0-9_]*|IQ\d[A-Z0-9_]*|F16|BF16|F32)\b/i.exec(job.label);
  return m ? m[1].toUpperCase() : null;
}
function renderDownloadMail(input) {
  const { job } = input;
  const name = modelName(job);
  const total = job.totalBytes > 0 ? job.totalBytes : job.transferredBytes;
  const started = Date.parse(job.startedAt);
  const finished = Date.parse(job.finishedAt ?? "") || (input.now ?? /* @__PURE__ */ new Date()).getTime();
  const took = formatDuration(finished - started);
  const q = quant(job);
  const what = job.phase === "mmproj" ? "VISION PROJECTOR" : "MODEL";
  const factsLine = [formatBytes(total), q, took !== "\u2014" ? took : null].filter(Boolean).join(" \xB7 ");
  if (job.status === "done") {
    const subject2 = `\u25B6 ${what} READY: ${name}`;
    const text2 = [
      `ATOMIC AGENT \u2014 TRANSMISSION ${transmissionCode(job)}`,
      "",
      `${what} READY`,
      `> ${name}`,
      `> ${factsLine}`,
      "> landed in your models folder",
      `> [${"\u2588".repeat(24)}] 100%`,
      "",
      "ADDITIONAL WEIGHTS ACQUIRED \xB7 RESEARCH COMPLETE",
      "",
      "\u25B6 PRESS START \u2014 open Atomic Agent, the model is ready to use.",
      "",
      `sent by ${input.from} \xB7 reply to talk to your agent`
    ].join("\n");
    const html2 = renderMailShell({
      transmission: `TRANSMISSION ${transmissionCode(job)}`,
      banner: what === "MODEL" ? "MODEL READY" : "VISION READY",
      bannerColor: SCREEN.green,
      readout: [
        `<span style="color:${SCREEN.green}">&gt;</span> ${esc(name)}`,
        `<span style="color:${SCREEN.green}">&gt;</span> ${esc(factsLine)}`,
        `<span style="color:${SCREEN.green}">&gt;</span> landed in your models folder`,
        `<span style="color:${SCREEN.green}">&gt;</span> ${renderBar(100, SCREEN.green)}`
      ],
      status: "ADDITIONAL WEIGHTS ACQUIRED \xB7 RESEARCH COMPLETE",
      cta: "PRESS START \u2014 open Atomic Agent, the model is ready to use.",
      from: input.from,
      title: `${what === "MODEL" ? "Model" : "Vision projector"} ready: ${name}`
    });
    return { subject: subject2, text: text2, html: html2 };
  }
  const reason = job.error ?? "unknown error";
  const percent = total > 0 ? Math.round(job.transferredBytes / total * 100) : 0;
  if (job.resumable) {
    const kept = job.transferredBytes > 0 ? `${formatBytes(job.transferredBytes)} of ${formatBytes(total)} kept on disk` : "nothing downloaded yet";
    const subject2 = `\u23F8 TRANSMISSION LOST: ${name} (${percent}%)`;
    const text2 = [
      `ATOMIC AGENT \u2014 TRANSMISSION ${transmissionCode(job)}`,
      "",
      "TRANSMISSION LOST",
      `> ${name}`,
      `> ${reason}`,
      `> ${kept}`,
      `> [${"\u2588".repeat(Math.round(percent / 100 * 24))}${"\u2591".repeat(24 - Math.round(percent / 100 * 24))}] ${percent}%`,
      "",
      "NOT ENOUGH BANDWIDTH \xB7 THE PARTIAL WAITS",
      "",
      "\u25B6 PRESS START \u2014 relaunch Atomic Agent and the download resumes by itself.",
      "",
      `sent by ${input.from} \xB7 reply to talk to your agent`
    ].join("\n");
    const html2 = renderMailShell({
      transmission: `TRANSMISSION ${transmissionCode(job)}`,
      banner: "SIGNAL LOST",
      bannerColor: SCREEN.amber,
      readout: [
        `<span style="color:${SCREEN.amber}">&gt;</span> ${esc(name)}`,
        `<span style="color:${SCREEN.amber}">&gt;</span> ${esc(reason)}`,
        `<span style="color:${SCREEN.amber}">&gt;</span> ${esc(kept)}`,
        `<span style="color:${SCREEN.amber}">&gt;</span> ${renderBar(percent, SCREEN.amber)}`
      ],
      status: "NOT ENOUGH BANDWIDTH \xB7 THE PARTIAL WAITS",
      cta: "PRESS START \u2014 relaunch Atomic Agent and the download resumes by itself.",
      from: input.from,
      title: `Download paused: ${name}`
    });
    return { subject: subject2, text: text2, html: html2 };
  }
  const subject = `\u2715 DOWNLOAD FAILED: ${name}`;
  const text = [
    `ATOMIC AGENT \u2014 TRANSMISSION ${transmissionCode(job)}`,
    "",
    "DOWNLOAD FAILED",
    `> ${name}`,
    `> ${reason}`,
    `> [${"\u2588".repeat(Math.round(percent / 100 * 24))}${"\u2591".repeat(24 - Math.round(percent / 100 * 24))}] ${percent}%`,
    "",
    "MISSION ABORTED \xB7 THE FILE, NOT THE LINK",
    "",
    "\u25B6 PRESS START \u2014 open Atomic Agent \u2192 Models to try again or pick another build.",
    "",
    `sent by ${input.from} \xB7 reply to talk to your agent`
  ].join("\n");
  const html = renderMailShell({
    transmission: `TRANSMISSION ${transmissionCode(job)}`,
    banner: "GAME OVER",
    bannerColor: SCREEN.red,
    readout: [
      `<span style="color:${SCREEN.red}">&gt;</span> ${esc(name)}`,
      `<span style="color:${SCREEN.red}">&gt;</span> ${esc(reason)}`,
      `<span style="color:${SCREEN.red}">&gt;</span> ${renderBar(percent, SCREEN.red)}`
    ],
    status: "MISSION ABORTED \xB7 THE FILE, NOT THE LINK",
    statusColor: SCREEN.red,
    cta: "PRESS START \u2014 open Atomic Agent \u2192 Models to try again or pick another build.",
    from: input.from,
    title: `Download failed: ${name}`
  });
  return { subject, text, html };
}
export {
  renderDownloadMail
};
