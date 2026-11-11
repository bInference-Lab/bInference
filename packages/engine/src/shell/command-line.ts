// One step of a command line: the words it runs, the first its program, and the step as written.
interface CommandStep {
  readonly words: readonly string[];
  readonly text: string;
}

/**
 * A command line as the allowed commands judge it (decision 0409): its steps, or `unreadable` when
 * it uses a shell feature whose effect its words do not show.
 */
export type CommandLine =
  | { readonly kind: "read"; readonly steps: readonly CommandStep[] }
  | { readonly kind: "unreadable" };

/** A word of the line, with where it starts and ends, or a separator between two steps. */
type Token =
  | { readonly kind: "word"; readonly value: string; readonly start: number; readonly end: number }
  | { readonly kind: "separator"; readonly joins: boolean; readonly end: number };

/** What a part of a word adds to it, and where the line goes on. */
interface Part {
  readonly value: string;
  readonly next: number;
}

const unreadable: CommandLine = { kind: "unreadable" };

// Characters that, unquoted, expand, redirect, group, background or start something no word
// shows: substitutions and variables, redirects, subshells and groups, globs and braces, tilde
// expansion, history and extended globs, and a `;;` or `&` that is no separator.
const refusedChars = new Set(["$", "`", "<", ">", "(", ")", "{", "}", "*", "?", "[", "]", "~"]);
const refusedToo = new Set(["!", "^", "&", ";", "\r"]);

// Characters that, unquoted at a word's start, comment the rest out or expand to a program's path.
const refusedFirst = new Set(["#", "="]);

// Words that, as a step's program, start a compound command, run other code in the shell, or change
// the shell's folder or state for the steps after them.
const shellWords: ReadonlySet<string> = new Set(
  (
    "if then else elif fi for while until do done case esac function select time coproc in " +
    "repeat foreach end nocorrect noglob eval exec source . command builtin cd pushd popd alias " +
    "unalias export unset set typeset declare local readonly trap shopt setopt unsetopt emulate " +
    "autoload zmodload enable disable hash rehash fc history let read mapfile readarray ulimit " +
    "umask printf getopts shift exit return logout break continue bind complete compgen wait jobs " +
    "fg bg disown suspend kill vared zle bindkey zstyle"
  ).split(" "),
);

// A step that starts by setting a variable, such as `PATH=/tmp ls`.
const assignment = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

// The separator at `at`, or none: `;;` is none, so it is refused as a character.
function separatorAt(line: string, at: number): Token | undefined {
  const two = line.slice(at, at + 2);
  if (two === "&&" || two === "||" || two === "|&") {
    return { kind: "separator", joins: true, end: at + 2 };
  }
  const one = line[at];
  if (one === "|") {
    return { kind: "separator", joins: true, end: at + 1 };
  }
  const isLast = one === ";" && line[at + 1] !== ";";
  return isLast || one === "\n" ? { kind: "separator", joins: false, end: at + 1 } : undefined;
}

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function singleQuoted(line: string, at: number): Part | undefined {
  const end = line.indexOf("'", at + 1);
  return end < 0 ? undefined : { value: line.slice(at + 1, end), next: end + 1 };
}

// One character inside double quotes: a backslash keeps only `$`, a backquote, `"`, `\` and a
// line break special, and a `$` or a backquote expands.
function doubleQuotedChar(line: string, at: number): Part | undefined {
  const char = line[at] ?? "";
  if (char === "$" || char === "`") {
    return undefined;
  }
  const next = line[at + 1] ?? "";
  if (char !== "\\" || !/^[$`"\\\n]$/u.test(next)) {
    return { value: char, next: at + 1 };
  }
  return next === "\n" ? undefined : { value: next, next: at + 2 };
}

function doubleQuoted(line: string, at: number): Part | undefined {
  let value = "";
  let cursor = at + 1;
  while (cursor < line.length && line[cursor] !== '"') {
    const part = doubleQuotedChar(line, cursor);
    if (part === undefined) {
      return undefined;
    }
    value += part.value;
    cursor = part.next;
  }
  return cursor < line.length ? { value, next: cursor + 1 } : undefined;
}

function escaped(line: string, at: number): Part | undefined {
  const next = line[at + 1];
  return next === undefined || next === "\n" ? undefined : { value: next, next: at + 2 };
}

function plain(
  line: string,
  cursor: { readonly at: number; readonly start: number },
): Part | undefined {
  const char = line[cursor.at] ?? "";
  const isFirst = cursor.at === cursor.start;
  const refused =
    refusedChars.has(char) ||
    refusedToo.has(char) ||
    /\p{Cc}/u.test(char) ||
    (isFirst && refusedFirst.has(char));
  return refused ? undefined : { value: char, next: cursor.at + 1 };
}

function partAt(line: string, cursor: { readonly at: number; readonly start: number }) {
  const char = line[cursor.at];
  if (char === "'") {
    return singleQuoted(line, cursor.at);
  }
  if (char === '"') {
    return doubleQuoted(line, cursor.at);
  }
  return char === "\\" ? escaped(line, cursor.at) : plain(line, cursor);
}

// The word from `start`, its quoted parts read and its escapes taken, to the next blank or
// separator.
function wordAt(line: string, start: number): Token | undefined {
  let value = "";
  let at = start;
  while (at < line.length && !isBlank(line[at]) && separatorAt(line, at) === undefined) {
    const part = partAt(line, { at, start });
    if (part === undefined) {
      return undefined;
    }
    value += part.value;
    at = part.next;
  }
  return { kind: "word", value, start, end: at };
}

function tokensOf(line: string): readonly Token[] | undefined {
  const tokens: Token[] = [];
  let at = 0;
  while (at < line.length) {
    if (isBlank(line[at])) {
      at += 1;
      continue;
    }
    const token = separatorAt(line, at) ?? wordAt(line, at);
    if (token === undefined) {
      return undefined;
    }
    tokens.push(token);
    at = token.end;
  }
  return tokens;
}

type WordToken = Extract<Token, { readonly kind: "word" }>;

function stepOf(line: string, words: readonly WordToken[]): CommandStep {
  const first = words[0]?.start ?? 0;
  const last = words.at(-1)?.end ?? first;
  return { words: words.map((word) => word.value), text: line.slice(first, last) };
}

// Groups the words into steps. A `|` or `&&` with no step on either side cannot run; a `;` or a
// line break with none is only an empty line.
function stepsOf(line: string, tokens: readonly Token[]): readonly CommandStep[] | undefined {
  const steps: CommandStep[] = [];
  let words: WordToken[] = [];
  let joined = false;
  for (const token of [...tokens, { kind: "separator", joins: false, end: line.length } as const]) {
    if (token.kind === "word") {
      words.push(token);
      continue;
    }
    if (words.length === 0 && (joined || token.joins)) {
      return undefined;
    }
    if (words.length > 0) {
      steps.push(stepOf(line, words));
    }
    words = [];
    joined = token.joins;
  }
  return steps;
}

// A step binference can judge: no variable set before its program, and a program that is no word
// of the shell's own.
function isPlainStep(step: CommandStep): boolean {
  const program = step.words[0] ?? "";
  return !assignment.test(step.text) && !shellWords.has(program) && program !== "";
}

/**
 * Splits a command line into its steps at `|`, `|&`, `&&`, `||`, `;` and line breaks, reading
 * single and double quotes and backslashes as a POSIX shell does (decision 0409). A line is
 * `unreadable` when anything in it expands, redirects, groups, backgrounds or comments, when a
 * quote is left open or a line continues, when a `|` or `&&` has no step on a side, when a step sets
 * a variable before its program, or when a step's program is a word of the shell's own.
 */
export function readCommandLine(line: string): CommandLine {
  const tokens = tokensOf(line);
  const steps = tokens === undefined ? undefined : stepsOf(line, tokens);
  if (steps === undefined || steps.length === 0 || !steps.every(isPlainStep)) {
    return unreadable;
  }
  return { kind: "read", steps };
}
