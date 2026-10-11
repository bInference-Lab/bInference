/** A sentence of a skill that tells the agent to ask for a secret. */
export interface SkillFinding {
  readonly code: "asks_for_secret";
  /** The line of the skill's text the sentence starts on, from 1. */
  readonly line: number;
  /** The secret the sentence asks for, as the skill writes it. */
  readonly secret: string;
  /** The sentence, its whitespace collapsed. */
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
  /\b(?:seed (?:phrase|words)|(?:secret )?recovery phrase|secret phrase|mnemonic(?: phrase)?|private keys?|secret keys?|api (?:keys?|secrets?)|passphrases?)\b/;

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

function findingOf(text: string, sentence: Sentence): SkillFinding | undefined {
  const plain = sentence.text.replace(/\s+/g, " ").trim();
  const lower = plain.toLowerCase();
  const english = englishSecret.exec(lower);
  const chinese = chineseSecret.exec(plain);
  const found = english ?? chinese;
  if (found === null || !(asksInEnglish(lower) || asksInChinese(plain))) {
    return undefined;
  }
  const secret = plain.slice(found.index, found.index + found[0].length);
  const start = sentence.offset + sentence.text.length - sentence.text.trimStart().length;
  const line = text.slice(0, start).split("\n").length;
  return { code: "asks_for_secret", line, secret, text: plain };
}

/**
 * Lints a skill's `SKILL.md`, frontmatter and body alike, for sentences that tell the agent to
 * ask for or collect a secret: a seed or recovery phrase, a private or secret key, an API
 * key or a passphrase, in English or Chinese. A sentence that forbids it, such as "Never ask for a
 * seed phrase", passes. It is the install lint of ARCHITECTURE.md section 5, which refuses a
 * skill with a finding; a skill's author runs it before publishing. It reads words, so a finding
 * names a sentence to review rather than proving intent.
 */
export function lintSkill(text: string): readonly SkillFinding[] {
  return sentencesOf(text)
    .map((sentence) => findingOf(text, sentence))
    .filter((finding) => finding !== undefined);
}
