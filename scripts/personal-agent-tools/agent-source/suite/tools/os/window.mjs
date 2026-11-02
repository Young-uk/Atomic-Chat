import { platform } from "node:os";
import { compressToolResult } from "../../compressor/result-compressor.mjs";
import { listingResultCaps } from "../../compressor/listing-caps.mjs";
import { runCommand } from "../../sandbox/command-runner.mjs";
const TITLE_CHARS = 240;
const osWindowListTool = {
  name: "os.window.list",
  description: "List visible window titles. On Linux requires `wmctrl`; macOS uses osascript; Windows uses PowerShell.",
  readonly: true,
  async run(_rawArgs, ctx) {
    const os = platform();
    const script = listScript(os);
    if (!script) {
      throw new Error(`os.window.list: unsupported platform ${os}`);
    }
    const result = await runCommand(script.cmd, script.args, {
      cwd: ctx.workingDir,
      signal: ctx.signal,
      timeoutMs: 1e4
    });
    if (result.exitCode !== 0) {
      return compressToolResult({
        tool: "os.window.list",
        status: "error",
        output: result.stderr || "window list failed",
        details: { platform: os, stderr: result.stderr }
      });
    }
    const lines = result.stdout.split(/\r?\n/);
    return compressToolResult(
      {
        tool: "os.window.list",
        status: "ok",
        output: result.stdout.trim(),
        details: { platform: os, lines: lines.length }
      },
      // One line per window, and `details` carries only a COUNT of the
      // lines — so anything the compressor cuts here is unrecoverable.
      // There is no `limit` to work from (the OS decides how many
      // windows exist), so budget the lines we are about to print at
      // TITLE_CHARS each — counted before the trim, so an empty list
      // still buys a line. ~16 windows fit the shared ceiling, which
      // is what bounds a busier desktop.
      listingResultCaps(lines.length, TITLE_CHARS)
    );
  }
};
const osWindowFocusTool = {
  name: "os.window.focus",
  description: "Bring a window to the foreground by matching its title (substring).",
  readonly: false,
  async run(rawArgs, ctx) {
    const title = rawArgs.title;
    if (typeof title !== "string" || title.length === 0) {
      throw new Error("os.window.focus: `title` must be a non-empty string");
    }
    const os = platform();
    const script = focusScript(os, title);
    if (!script) {
      throw new Error(`os.window.focus: unsupported platform ${os}`);
    }
    const result = await runCommand(script.cmd, script.args, {
      cwd: ctx.workingDir,
      signal: ctx.signal,
      timeoutMs: 1e4
    });
    const status = result.exitCode === 0 ? "ok" : "error";
    return compressToolResult({
      tool: "os.window.focus",
      status,
      output: status === "ok" ? `focused window matching "${title}"` : result.stderr || "window focus failed",
      details: { platform: os, title, exitCode: result.exitCode }
    });
  }
};
function listScript(os) {
  switch (os) {
    case "darwin":
      return {
        cmd: "osascript",
        args: [
          "-e",
          'tell application "System Events" to get {name, (every window whose visible is true)} of every process whose background only is false'
        ]
      };
    case "linux":
      return { cmd: "wmctrl", args: ["-l"] };
    case "win32":
      return {
        cmd: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, MainWindowTitle | Format-Table -AutoSize | Out-String"
        ]
      };
    default:
      return null;
  }
}
function focusScript(os, title) {
  switch (os) {
    case "darwin":
      return {
        cmd: "osascript",
        args: [
          "-e",
          `tell application "System Events" to tell (first process whose frontmost is false and (name contains "${escapeAppleScript(title)}")) to set frontmost to true`
        ]
      };
    case "linux":
      return { cmd: "wmctrl", args: ["-a", title] };
    case "win32":
      return {
        cmd: "powershell.exe",
        args: ["-NoProfile", "-Command", buildWindowsFocusScript(title)]
      };
    default:
      return null;
  }
}
function buildWindowsFocusScript(title) {
  const needle = escapePowerShell(title);
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type @"',
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class AtomicWin32 {",
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    "}",
    '"@',
    `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${needle}*' } | Select-Object -First 1`,
    "if (-not $p) { Write-Error 'no matching window'; exit 1 }",
    "[void][AtomicWin32]::ShowWindow($p.MainWindowHandle, 9)",
    "[void][AtomicWin32]::SetForegroundWindow($p.MainWindowHandle)"
  ].join("\n");
}
function escapeAppleScript(input) {
  return input.replace(/"/g, '\\"');
}
function escapePowerShell(input) {
  return input.replace(/'/g, "''");
}
export {
  osWindowFocusTool,
  osWindowListTool
};
