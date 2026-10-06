import type { WordLists } from "./word-lists.mjs";

/** One rule broken on one line. */
export interface LineFinding {
  readonly rule: string;
  readonly message: string;
}

/** What a line rule may know about the line. */
export interface LineContext {
  readonly file: string;
  /** The line without code: Markdown code spans and code blocks are left out. */
  readonly prose: string;
  readonly lists: WordLists;
  readonly reservedIn: (line: string) => readonly string[];
}

const dashPattern = /[\u2013\u2014\u2015]/;
const emojiPattern = /\p{Emoji_Presentation}/u;
const planIdPatterns: readonly RegExp[] = [
  /\bP[0-9]-[A-Z]{0,2}[0-9]{1,3}\b/,
  /\bA[0-9]{1,3}\b/,
  /\bC[0-9]{2}\b/,
  /\bX[0-9]{1,2}\b/,
  /\bG[0-4]\b/,
  /\b[Pp]hase [0-9]\b/,
];
const productPattern = /\b[Bb][Ii][Nn][Ff][Ee][Rr][Ee][Nn][Cc][Ee]\b/g;
const productSpellings = new Set(["binference", "bInference"]);
const cjkPattern = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const zhFile = /(?:^|[/.])zh(?:[/.-]|$)/i;
const languageLink = /<a href="[^"]*zh[^"]*">[^<]*<\/a>|\[[^\]]*\]\([^)]*zh[^)]*\)/gi;
const localPathPatterns: readonly RegExp[] = [
  /\/Users\/[^/\s]+\//,
  /\/home\/[^/\s]+\//,
  /[A-Za-z]:\\+Users\\+/,
];
const internalPatterns: readonly RegExp[] = [
  /\]\((?:\.{1,2}\/)*internal\//,
  /(?:^|[\s`'"(])(?:\.{1,2}\/)*internal\//,
];

function finding(rule: string, message: string): LineFinding {
  return { rule, message };
}

function bannedWords(context: LineContext): LineFinding[] {
  const words = context.prose.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
  return words
    .filter((word) => context.lists.banned.has(word))
    .map((word) => finding("banned-word", `"${word}" is filler; say what happens instead.`));
}

function planIds(line: string, context: LineContext): LineFinding[] {
  return [
    ...planIdPatterns
      .filter((pattern) => pattern.test(line))
      .map((pattern) =>
        finding("plan-id", `Internal ids and phases stay out of public text (${pattern.source}).`),
      ),
    ...(/\bas\s+discussed\b/i.test(context.prose)
      ? [finding("plan-id", "Say what was decided, not that it was discussed.")]
      : []),
  ];
}

function reservedNames(line: string, context: LineContext): LineFinding[] {
  const allowed = context.lists.exceptions.get(context.file) ?? new Set<string>();
  return context
    .reservedIn(line)
    .filter((hash) => !allowed.has(hash))
    .map(() => finding("reserved-name", "A name from another agent framework; see the glossary."));
}

function productCase(context: LineContext): LineFinding[] {
  return [...context.prose.matchAll(productPattern)]
    .map((match) => match[0])
    .filter((spelling) => !productSpellings.has(spelling))
    .map((spelling) =>
      finding("product-case", `Write the product as binference, not ${spelling}.`),
    );
}

function cjk(line: string, file: string): LineFinding[] {
  if (zhFile.test(file) || !cjkPattern.test(line.replace(languageLink, ""))) {
    return [];
  }
  return [finding("cjk", "Chinese text belongs in a zh file or the zh messages.")];
}

function paths(line: string, file: string): LineFinding[] {
  const local = localPathPatterns.some((pattern) => pattern.test(line));
  const internal = file !== ".gitignore" && internalPatterns.some((pattern) => pattern.test(line));
  return [
    ...(local ? [finding("local-path", "A path on someone's machine; use a repo path.")] : []),
    ...(internal ? [finding("internal-link", "The internal folder is never linked.")] : []),
  ];
}

function trailers(line: string, context: LineContext): LineFinding[] {
  const lower = line.toLowerCase();
  const coauthor = /^\s*co-authored-by:/.test(lower);
  const generated = /\bgenerated (?:with|by)\b/.test(lower);
  if (!coauthor && !generated) {
    return [];
  }
  const words = new Set(lower.match(/[a-z]+/g) ?? []);
  const namesTool = context.lists.aiTools.some((tool) => words.has(tool));
  const bot = /\[bot\]|noreply@anthropic\.com/.test(lower);
  if ((coauthor && (namesTool || bot)) || (generated && namesTool)) {
    return [finding("ai-trailer", "No AI attribution; Co-authored-by names people only.")];
  }
  return [];
}

/** Every style rule that applies to one line of any text. */
export function checkLine(line: string, context: LineContext): readonly LineFinding[] {
  return [
    ...(dashPattern.test(line) ? [finding("dash", "No em or en dashes as punctuation.")] : []),
    ...(emojiPattern.test(line) ? [finding("emoji", "No emojis in code, docs or commits.")] : []),
    ...bannedWords(context),
    ...planIds(line, context),
    ...reservedNames(line, context),
    ...productCase(context),
    ...cjk(line, context.file),
    ...paths(line, context.file),
    ...trailers(line, context),
  ];
}
