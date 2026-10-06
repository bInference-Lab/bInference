import type { AreaMessages, MessageFiles, MessageProblem } from "./message-files.js";
import type { GlossaryTerm } from "./parse-glossary.js";
import { parseMessage } from "./parse-message.js";

interface TermPattern {
  readonly term: GlossaryTerm;
  readonly pattern: Readonly<RegExp>;
}

// The glossary's terms pair English messages with Chinese ones.
const sourceLocale = "en";
const targetLocale = "zh";
// A rendering that starts with the mark of a finished action (U+5DF2, "already") also counts
// without it, because Chinese moves the mark: "Cancelled on {surface}" puts it before the
// argument and the verb after it.
const finishedMark = String.fromCodePoint(0x5df2);
const codeSpan = /`[^`]*`/g;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole words only, any case, with an optional plural ending: "fees" uses "fee".
function patternOf(term: GlossaryTerm): TermPattern {
  const words = term.english
    .split(/\s+/)
    .map((word) => escapeRegex(word))
    .join("\\s+");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?:s|es)?(?![\\p{L}\\p{N}])`, "giu");
  return { term, pattern };
}

// Longer terms first, each match cut out, so "network fee" is not read as "fee" as well.
function termsIn(english: string, patterns: readonly TermPattern[]): readonly GlossaryTerm[] {
  let rest = english;
  const found: GlossaryTerm[] = [];
  for (const item of patterns) {
    const cut = rest.replace(item.pattern, "\n");
    if (cut !== rest) {
      found.push(item.term);
      rest = cut;
    }
  }
  return found;
}

function compact(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

// The rendering of "paired with" holds X where an argument goes: its parts must appear in order.
function rendersIn(chinese: string, rendering: string): boolean {
  let from = 0;
  for (const part of rendering.split(/\s+X\s+/).map(compact)) {
    const at = chinese.indexOf(part, from);
    if (at === -1) {
      return false;
    }
    from = at + part.length;
  }
  return true;
}

function usesTerm(chinese: string, term: GlossaryTerm): boolean {
  return term.chinese.some(
    (rendering) =>
      rendersIn(chinese, rendering) ||
      (rendering.startsWith(finishedMark) && rendersIn(chinese, rendering.slice(1))),
  );
}

function wordsOf(message: string): string {
  const parsed = parseMessage(message);
  return parsed.ok ? parsed.value.text.replace(codeSpan, "\n") : "";
}

function termProblem(term: GlossaryTerm): string {
  return (
    `The English uses "${term.english}", which the glossary writes as ` +
    `${term.chinese.join(" or ")}, and the Chinese uses none of them. Use the glossary's word, ` +
    "or add this sense to docs/GLOSSARY.md first."
  );
}

/**
 * Checks every Chinese message against the glossary: where the English message uses a glossary
 * term, the Chinese must use one of the Chinese words the glossary gives it. Words in code spans
 * and argument names are skipped.
 */
export function checkGlossary(
  files: MessageFiles,
  terms: readonly GlossaryTerm[],
): readonly MessageProblem[] {
  const patterns = terms
    .toSorted((a, b) => b.english.length - a.english.length)
    .map((term) => patternOf(term));
  const source = files[sourceLocale] ?? {};
  const target = files[targetLocale] ?? {};
  return Object.entries(source).flatMap(([area, entries]: readonly [string, AreaMessages]) =>
    Object.entries(entries).flatMap(([key, english]: readonly [string, string]) => {
      const chinese = target[area]?.[key];
      if (chinese === undefined) {
        return [];
      }
      const translated = compact(wordsOf(chinese));
      return termsIn(wordsOf(english), patterns)
        .filter((term) => !usesTerm(translated, term))
        .map((term): MessageProblem => ({
          locale: targetLocale,
          area,
          key,
          text: termProblem(term),
        }));
    }),
  );
}
