const TERMINAL_FAILURE = /setupterm|could not find terminal|_curses\.error|Error opening terminal|initscr|cbreak\(\) returned ERR|Raw mode is not supported|stdin is not a terminal|stdout is not a terminal/i;
const TERMINAL_APP_HINT = "This looks like a full-screen terminal (curses/TUI) program. verify.run runs commands without a terminal, so such a program cannot be checked this way. Check its logic instead: import the module and call its functions in a short script or a test, with the screen code kept out of the path.";
function terminalAppHint(stdout, stderr) {
  return TERMINAL_FAILURE.test(stderr) || TERMINAL_FAILURE.test(stdout) ? TERMINAL_APP_HINT : void 0;
}
export {
  TERMINAL_APP_HINT,
  terminalAppHint
};
