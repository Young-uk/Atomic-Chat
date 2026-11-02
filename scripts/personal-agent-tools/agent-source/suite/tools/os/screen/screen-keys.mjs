const MODIFIER_FLAGS = {
  shift: 131072,
  ctrl: 262144,
  control: 262144,
  alt: 524288,
  opt: 524288,
  option: 524288,
  cmd: 1048576,
  command: 1048576,
  meta: 1048576,
  super: 1048576,
  fn: 8388608
};
const LETTERS = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  o: 31,
  u: 32,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  k: 40,
  n: 45,
  m: 46
};
const DIGITS_AND_PUNCTUATION = {
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  "[": 33,
  "'": 39,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  ".": 47,
  "`": 50
};
const NAMED_KEYS = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  forwarddelete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111
};
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "cmd", "fn"];
const CANONICAL_MODIFIER = {
  shift: "shift",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  opt: "alt",
  option: "alt",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  super: "cmd",
  fn: "fn"
};
function parseKeyChord(raw) {
  const spec = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (spec.length === 0) {
    throw new Error('`keys` must name a key, e.g. "return" or "cmd+shift+t"');
  }
  const parts = spec.split("+");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`\`keys\` "${raw}" has an empty part; for the plus sign use "shift+="`);
  }
  const keyName = parts[parts.length - 1];
  let flags = 0;
  const modifiers = /* @__PURE__ */ new Set();
  for (const part of parts.slice(0, -1)) {
    const flag = MODIFIER_FLAGS[part];
    if (flag === void 0) {
      throw new Error(`unknown modifier "${part}" in \`keys\`; use cmd, shift, ctrl, alt or fn`);
    }
    flags |= flag;
    modifiers.add(CANONICAL_MODIFIER[part]);
  }
  const keyCode = keyCodeFor(keyName);
  if (keyCode === void 0) {
    throw new Error(
      `unknown key "${keyName}" in \`keys\`; use a letter, a digit, punctuation, return, tab, space, delete, escape, an arrow (up/down/left/right), home, end, pageup, pagedown or f1..f12`
    );
  }
  const label = [...MODIFIER_ORDER.filter((m) => modifiers.has(m)), keyName].join("+");
  return { keyCode, flags, label };
}
function keyCodeFor(name) {
  return LETTERS[name] ?? DIGITS_AND_PUNCTUATION[name] ?? NAMED_KEYS[name];
}
export {
  parseKeyChord
};
