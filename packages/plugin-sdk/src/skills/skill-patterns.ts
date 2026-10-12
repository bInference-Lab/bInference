// What a skill's text may not carry besides a request for a secret: a download piped into a
// shell, a secret store sent over the network, or a secret written out in full.

/** The kind of finding a pattern rule makes. */
export type PatternCode = "pipe_to_shell" | "exfiltration" | "literal_secret";

/** One match of a pattern rule in a sentence. */
export interface PatternMatch {
  readonly code: PatternCode;
  /** Where the match starts in the sentence. */
  readonly index: number;
  /** For a literal secret, what it looks like; every match of it is redacted from the text. */
  readonly secret?: string;
}

const download = String.raw`(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)`;
const runner = String.raw`(?:sudo\s+)?(?:ba|z|k|da|fi)?sh|python3?|node|perl|ruby|iex|pwsh|powershell`;

// A download whose output a shell or an interpreter runs: piped in, or substituted into one.
const pipeToShell: readonly RegExp[] = [
  new RegExp(String.raw`\b${download}\b[^|\n]{0,240}\|\s*(?:${runner})\b`, "i"),
  new RegExp(String.raw`\b(?:ba|z)?sh\s+(?:-c\s+)?["']?\$\(\s*${download}\b`, "i"),
  new RegExp(String.raw`\b(?:ba|z)?sh\s+<\(\s*${download}\b`, "i"),
  new RegExp(String.raw`\biex\s*\(+\s*(?:${download}|new-object\s+net\.webclient)\b`, "i"),
];

// Where secrets sit: the whole environment, key and credential files, keychains and wallets. A
// single named variable, such as a key sent in an API's own header, is not a store.
const secretStore =
  /\b(?:printenv|env\s*\||process\.env\b(?!\.)|os\.environ\b(?![[.])|security\s+(?:find|dump)-[a-z-]+|keychain|id_(?:rsa|ed25519|ecdsa)|wallet\.dat|keystore)|~\/\.(?:ssh|aws|gnupg|binference|netrc)|(?:^|[\s"'`(@=/])\.env\b/i;
const sender =
  /\b(?:curl|wget|nc|ncat|netcat|scp|rsync|sftp|ftp|telnet|invoke-webrequest|invoke-restmethod|iwr|irm|webhook)\b|\bfetch\s*\(|\brequests\.(?:post|put)\b|\bhttps?:\/\//i;

/** A secret written out, by what it looks like. */
interface LiteralRule {
  readonly secret: string;
  readonly pattern: RegExp;
  /** The sentence must also name this, so a hash or an id of the same shape passes. */
  readonly named?: RegExp;
  /** Whether a match is one, past its shape. */
  readonly accept?: (found: string) => boolean;
}

// A seed phrase has 12, 15, 18, 21 or 24 words (BIP-39).
const seedLengths: ReadonlySet<number> = new Set([12, 15, 18, 21, 24]);

function isSeedLength(found: string): boolean {
  return seedLengths.has(found.trim().split(/\s+/).length);
}

const literalRules: readonly LiteralRule[] = [
  { secret: "private key block", pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  {
    secret: "private key",
    pattern: /\b(?:0x)?[0-9a-fA-F]{64}\b/g,
    named: /\b(?:private|secret|signing)[ _-]?keys?\b|\bpriv(?:ate)?key\b|\bpk\b/i,
  },
  {
    secret: "seed phrase",
    // The words alone between quotes, backticks, a colon or the ends of a line.
    pattern: /(?<=^|[:"'`]\s*)(?:[a-z]{3,8} ){11,23}[a-z]{3,8}(?=\s*(?:$|["'`.]))/gm,
    named: /\b(?:seed|mnemonic|recovery)\b/i,
    accept: isSeedLength,
  },
  { secret: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { secret: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})\b/g },
  { secret: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { secret: "API key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { secret: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { secret: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { secret: "Telegram bot token", pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { secret: "client token", pattern: /\bbnt_[A-Za-z0-9_-]{20,}/g },
];

// A negation before a command in the same sentence, as in "never run curl ... | sh", passes it.
const negation = /\b(?:never|not|don't|dont|avoid)\b/i;

function isNegated(sentence: string, index: number): boolean {
  return negation.test(sentence.slice(0, index));
}

function pipeMatch(sentence: string): PatternMatch | undefined {
  const indexes = pipeToShell.flatMap((rule) => {
    const found = rule.exec(sentence);
    return found === null ? [] : [found.index];
  });
  const index = Math.min(...indexes);
  return indexes.length === 0 || isNegated(sentence, index)
    ? undefined
    : { code: "pipe_to_shell", index };
}

function exfiltrationMatch(sentence: string): PatternMatch | undefined {
  const store = secretStore.exec(sentence);
  const send = sender.exec(sentence);
  if (store === null || send === null) {
    return undefined;
  }
  const index = Math.min(store.index, send.index);
  return isNegated(sentence, index) ? undefined : { code: "exfiltration", index };
}

// The rule's matches in a sentence that names what the rule needs.
function foundBy(rule: LiteralRule, sentence: string): readonly RegExpExecArray[] {
  if (rule.named !== undefined && !rule.named.test(sentence)) {
    return [];
  }
  const { accept } = rule;
  const found = [...sentence.matchAll(rule.pattern)];
  return accept === undefined ? found : found.filter((match) => accept(match[0]));
}

function literalMatches(sentence: string): readonly PatternMatch[] {
  return literalRules.flatMap((rule) => {
    const [first] = foundBy(rule, sentence);
    return first === undefined
      ? []
      : [{ code: "literal_secret" as const, index: first.index, secret: rule.secret }];
  });
}

/** Every pattern rule's match in one sentence, in the order of the rules. */
export function patternMatches(sentence: string): readonly PatternMatch[] {
  return [pipeMatch(sentence), exfiltrationMatch(sentence), ...literalMatches(sentence)].filter(
    (match) => match !== undefined,
  );
}

/** The sentence with every literal secret the rules find in it replaced by `[redacted]`. */
export function redacted(sentence: string): string {
  return literalRules.reduce(
    (text, rule) =>
      foundBy(rule, sentence).reduce(
        (kept, match) => kept.replaceAll(match[0], "[redacted]"),
        text,
      ),
    sentence,
  );
}
