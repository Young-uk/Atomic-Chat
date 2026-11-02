import { homedir } from "node:os";
const SEPARATOR = { kind: "separator" };
const WRITE = { kind: "redirect", writes: "file" };
const DUP = { kind: "redirect", writes: "dup" };
const READ = { kind: "redirect", writes: "none" };
const OPERATORS = {
  posix: [
    ["&&", SEPARATOR],
    ["||", SEPARATOR],
    [";;", SEPARATOR],
    ["|&", SEPARATOR],
    ["&>>", WRITE],
    ["&>", WRITE],
    ["<<<", READ],
    ["<<-", { kind: "heredoc", stripTabs: true }],
    ["<<", { kind: "heredoc", stripTabs: false }],
    ["<>", WRITE],
    ["<&", READ],
    [">>", WRITE],
    [">|", WRITE],
    [">&", DUP],
    [">", WRITE],
    ["<", READ],
    [";", SEPARATOR],
    ["|", SEPARATOR],
    ["&", SEPARATOR],
    ["(", { kind: "open" }],
    [")", { kind: "close" }]
  ],
  // `;` is not a command separator in cmd.exe.
  cmd: [
    ["&&", SEPARATOR],
    ["||", SEPARATOR],
    [">>", WRITE],
    [">&", DUP],
    ["<&", READ],
    [">", WRITE],
    ["<", READ],
    ["|", SEPARATOR],
    ["&", SEPARATOR],
    ["(", { kind: "open" }],
    [")", { kind: "close" }]
  ],
  powershell: [
    ["&&", SEPARATOR],
    ["||", SEPARATOR],
    ["*>>", WRITE],
    ["*>", WRITE],
    [">>", WRITE],
    [">&", DUP],
    [">", WRITE],
    [";", SEPARATOR],
    ["|", SEPARATOR],
    ["&", SEPARATOR],
    ["(", { kind: "open" }],
    [")", { kind: "close" }]
  ]
};
function lexShellLine(line, dialect) {
  const tokens = [];
  const heredocs = [];
  const operators = OPERATORS[dialect];
  const escape = dialect === "posix" ? "\\" : dialect === "cmd" ? "^" : null;
  const singleQuotes = dialect !== "cmd";
  const variables = dialect !== "cmd";
  let word = "";
  let inWord = false;
  let quoted = false;
  let dynamic = false;
  let pendingHeredoc = null;
  const endWord = () => {
    if (!inWord) return;
    if (pendingHeredoc !== null) {
      heredocs.push({ delimiter: word, ...pendingHeredoc });
      pendingHeredoc = null;
    } else {
      tokens.push({ kind: "word", text: word, dynamic });
    }
    word = "";
    inWord = false;
    quoted = false;
    dynamic = false;
  };
  const openQuote = (first) => {
    if (!inWord && first === "~") dynamic = true;
    quoted = true;
    inWord = true;
  };
  const appendDollar = (at) => {
    const read = readDollar(line, at, word.length === 0);
    if (read === null) return null;
    word += read.text;
    dynamic ||= read.dynamic;
    inWord = true;
    return read.next;
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "\n") {
      endWord();
      if (pendingHeredoc !== null) return null;
      tokens.push(SEPARATOR);
      i = skipHeredocBodies(line, i + 1, heredocs);
      heredocs.length = 0;
      continue;
    }
    if (c === " " || c === "	" || c === "\r") {
      endWord();
      i += 1;
      continue;
    }
    if (escape !== null && c === escape) {
      const next = line[i + 1];
      if (next === void 0) return null;
      if (next !== "\n") {
        word += next;
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (c === "`") return null;
    if (singleQuotes && c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return null;
      openQuote(line[i + 1]);
      word += line.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      openQuote(line[i + 1]);
      let j = i + 1;
      for (; ; ) {
        const d = line[j];
        if (d === void 0) return null;
        if (d === '"') break;
        if (d === "`") return null;
        if (dialect === "posix" && d === "\\") {
          const next = line[j + 1];
          if (next !== void 0 && '"\\$`\n'.includes(next)) {
            if (next !== "\n") word += next;
            j += 2;
            continue;
          }
        }
        if (variables && d === "$") {
          const next = appendDollar(j);
          if (next === null) return null;
          j = next;
          continue;
        }
        if (dialect === "cmd" && d === "%") dynamic = true;
        word += d;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (variables && c === "$") {
      const next = appendDollar(i);
      if (next === null) return null;
      i = next;
      continue;
    }
    if (dialect !== "cmd" && c === "#" && !inWord) {
      const newline = line.indexOf("\n", i);
      i = newline === -1 ? line.length : newline;
      continue;
    }
    const match = operators.find(([text]) => line.startsWith(text, i));
    if (match !== void 0) {
      const [text, operator] = match;
      const redirect = operator.kind === "redirect" || operator.kind === "heredoc";
      if (redirect && inWord && !quoted && !dynamic && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      }
      endWord();
      if (pendingHeredoc !== null) return null;
      if (operator.kind === "heredoc") {
        pendingHeredoc = { stripTabs: operator.stripTabs };
      } else {
        tokens.push(operator);
      }
      i += text.length;
      continue;
    }
    if (dialect === "posix" && /[*?[]/.test(c)) dynamic = true;
    if (dialect === "posix" && c === "{" && (inWord || !/^\s?$/.test(line[i + 1] ?? ""))) {
      dynamic = true;
    }
    if (dialect === "cmd" && c === "%") dynamic = true;
    word += c;
    inWord = true;
    i += 1;
  }
  endWord();
  if (pendingHeredoc !== null) return null;
  return tokens;
}
function readDollar(line, at, wordStart) {
  const next = line[at + 1];
  if (next === "(") return null;
  if (next === "{") {
    if (wordStart && line.startsWith("${HOME}", at)) {
      return { text: homedir(), dynamic: false, next: at + "${HOME}".length };
    }
    return null;
  }
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(at + 1))?.[0];
  if (name !== void 0) {
    if (wordStart && name === "HOME") {
      return { text: homedir(), dynamic: false, next: at + 1 + name.length };
    }
    return { text: `$${name}`, dynamic: true, next: at + 1 + name.length };
  }
  if (next !== void 0 && /[0-9@*#?$!-]/.test(next)) {
    return { text: `$${next}`, dynamic: true, next: at + 2 };
  }
  return { text: "$", dynamic: false, next: at + 1 };
}
function skipHeredocBodies(line, from, heredocs) {
  let i = from;
  for (const heredoc of heredocs) {
    while (i < line.length) {
      const newline = line.indexOf("\n", i);
      const end = newline === -1 ? line.length : newline;
      let text = line.slice(i, end).replace(/\r$/, "");
      if (heredoc.stripTabs) text = text.replace(/^\t+/, "");
      i = newline === -1 ? line.length : newline + 1;
      if (text === heredoc.delimiter) break;
    }
  }
  return i;
}
export {
  lexShellLine
};
