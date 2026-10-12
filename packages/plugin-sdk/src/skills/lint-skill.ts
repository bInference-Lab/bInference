import { type PatternCode, patternMatches, redacted } from "./skill-patterns.js";

/**
 * A sentence of a skill that the install refuses: one that tells the agent to ask for a secret
 * (`asks_for_secret`), runs a download in a shell (`pipe_to_shell`), sends a secret store over
 * the network (`exfiltration`), or holds a secret written out (`literal_secret`).
 */
export interface SkillFinding {
  readonly code: "asks_for_secret" | PatternCode;
  /** The line of the skill's text the sentence starts on, from 1. */
  readonly line: number;
  /**
   * For `asks_for_secret`, the secret the sentence asks for, as the skill writes it; for
   * `literal_secret`, what the secret looks like.
   */
  readonly secret?: string;
  /** The sentence, its whitespace collapsed, with every secret written out in it redacted. */
  readonly text: string;
}

interface Sentence {
  readonly offset: number;
  readonly text: string;
}

// A sentence ends at its stop mark (Chinese ones too), a blank line, or the next list item, quote,
// table row or heading.
const boundary =
  /[.!?;](?=\s|$)|[\u3002\uff01\uff1f\uff1b]|\n[ \t]*\n|\n(?=[ \t]*(?:[-*+>|#]|\d+\.)[ \t])/g;

const englishSecret =
  /\b(?:seed (?:phrase|words)|(?:secret )?recovery phrase|secret phrase|mnemonic(?: phrase)?|private keys?|secret keys?|api (?:keys?|secrets?)|passphrases?|passwords?|keystore(?: file)?|(?:access|auth|bot) tokens?|(?:2fa|one-time|otp) codes?)\b/;

const englishAsk = new Set([
  "ask",
  "asks",
  "asking",
  "request",
  "requests",
  "provide",
  "provides",
  "enter",
  "enters",
  "type",
  "paste",
  "pastes",
  "send",
  "sends",
  "share",
  "shares",
  "give",
  "gives",
  "submit",
  "input",
  "upload",
  "collect",
  "collects",
  "require",
  "requires",
  "need",
  "needs",
  "prompt",
]);

const englishNegation = new Set(["never", "not", "don't", "dont", "no", "cannot", "can't", "nor"]);

// Chinese, in escapes since code carries no CJK text: seed phrase, private key, secret key and
// recovery phrase; the verbs ask, provide, enter, send, paste, tell, fill in, upload, demand,
// require and share; the negations do not, never (two forms), please do not, forbid and must not.
const chineseSecret = /\u52a9\u8bb0\u8bcd|\u79c1\u94a5|\u5bc6\u94a5|\u6062\u590d\u77ed\u8bed/;
const chineseAsk =
  /\u8be2\u95ee|\u63d0\u4f9b|\u8f93\u5165|\u53d1\u9001|\u7c98\u8d34|\u544a\u8bc9|\u586b\u5199|\u4e0a\u4f20|\u7d22\u8981|\u8981\u6c42|\u5206\u4eab/g;
const chineseNegation =
  /\u4e0d\u8981|\u5207\u52ff|\u7edd\u4e0d|\u8bf7\u52ff|\u7981\u6b62|\u4e0d\u5f97/;
// How many characters before a Chinese verb a negation still governs it.
const chineseReach = 6;
// How many words before an English verb a negation still governs it, with no comma between.
const englishReach = 3;

function sentencesOf(text: string): readonly Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    sentences.push({ offset: start, text: text.slice(start, end) });
    start = end;
  }
  sentences.push({ offset: start, text: text.slice(start) });
  return sentences;
}

// Whether a negation sits among the few words before the verb at `index`, after any comma.
function negatedWord(tokens: readonly string[], index: number): boolean {
  const before = tokens.slice(Math.max(0, index - englishReach), index);
  const comma = before.lastIndexOf(",");
  return before.slice(comma + 1).some((token) => englishNegation.has(token));
}

// A sentence that opens with a negation, such as "Never, whoever asks, ...", negates all of it.
function asksInEnglish(sentence: string): boolean {
  const tokens = sentence.match(/[a-z']+|,/g) ?? [];
  if (tokens[0] !== undefined && ["never", "don't", "dont"].includes(tokens[0])) {
    return false;
  }
  return tokens.some((token, index) => englishAsk.has(token) && !negatedWord(tokens, index));
}

function asksInChinese(sentence: string): boolean {
  if (sentence.search(chineseNegation) === 0) {
    return false;
  }
  return [...sentence.matchAll(chineseAsk)].some((match) => {
    const before = sentence.slice(Math.max(0, match.index - chineseReach), match.index);
    return !chineseNegation.test(before);
  });
}

// The secret a sentence asks for, as the sentence writes it, if it asks for one.
function askedSecret(plain: string): string | undefined {
  const lower = plain.toLowerCase();
  const found = englishSecret.exec(lower) ?? chineseSecret.exec(plain);
  if (found === null || !(asksInEnglish(lower) || asksInChinese(plain))) {
    return undefined;
  }
  return plain.slice(found.index, found.index + found[0].length);
}

function findingsOf(text: string, sentence: Sentence): readonly SkillFinding[] {
  const plain = sentence.text.replace(/\s+/g, " ").trim();
  const start = sentence.offset + sentence.text.length - sentence.text.trimStart().length;
  const line = text.slice(0, start).split("\n").length;
  // Patterns read the sentence as written, so a command's lines and a quoted phrase stay whole.
  const shown = redacted(plain);
  const secret = askedSecret(plain);
  const asks: readonly SkillFinding[] =
    secret === undefined ? [] : [{ code: "asks_for_secret", line, secret, text: shown }];
  const patterns = patternMatches(sentence.text).map((match): SkillFinding =>
    match.secret === undefined
      ? { code: match.code, line, text: shown }
      : { code: match.code, line, secret: match.secret, text: shown },
  );
  return [...asks, ...patterns];
}

/**
 * Lints a skill's text, its `SKILL.md` frontmatter and body or any other text file of the skill,
 * for sentences that tell the agent to ask for or collect a secret (a seed or recovery phrase, a
 * private or secret key, an API key, a token, a password or a passphrase, in English or Chinese),
 * that pipe a download into a shell, that send the environment or a key file over the network, or
 * that write a secret out in full. A sentence that forbids it, such as "Never ask for a seed
 * phrase", passes. It is the install lint of ARCHITECTURE.md section 5, which refuses a skill with
 * a finding; a skill's author runs it before publishing. It reads words and shapes, so a finding
 * names a sentence to review rather than proving intent. No finding repeats a secret it found.
 */
export function lintSkill(text: string): readonly SkillFinding[] {
  return sentencesOf(text).flatMap((sentence) => findingsOf(text, sentence));
}
