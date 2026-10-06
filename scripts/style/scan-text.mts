import { checkLine, type LineFinding } from "./line-rules.mjs";
import { createReservedCheck } from "./reserved-names.mjs";
import type { WordLists } from "./word-lists.mjs";

/** A broken rule at a place in a file or message. */
export interface Finding extends LineFinding {
  readonly where: string;
  readonly line: number;
}

const fence = /^\s{0,3}(?:```|~~~)/;

function place(item: LineFinding, where: string, line: number): Finding {
  return { rule: item.rule, message: item.message, where, line };
}

const codeSpan = /`[^`]*`/g;

/** Checks text line by line. Markdown code is skipped by the rules about prose words. */
export function createTextScanner(
  lists: WordLists,
): (where: string, text: string) => readonly Finding[] {
  const reservedIn = createReservedCheck(lists.reserved);
  return (where, text) => {
    const markdown = /\.mdx?$/.test(where);
    let inCode = false;
    return text.split("\n").flatMap((line, index) => {
      if (markdown && fence.test(line)) {
        inCode = !inCode;
      }
      let prose = line;
      if (markdown) {
        prose = inCode ? "" : line.replace(codeSpan, "");
      }
      return checkLine(line, { file: where, prose, lists, reservedIn }).map((item) =>
        place(item, where, index + 1),
      );
    });
  };
}

const vagueMessage = "Vague words say nothing; name what changed.";

function messageLineFindings(line: string, lists: WordLists): LineFinding[] {
  const words = line.toLowerCase().match(/[a-z]+/g) ?? [];
  return [
    ...words
      .filter((word) => lists.vague.has(word))
      .map((word) => ({ rule: "vague-word", message: `"${word}": ${vagueMessage}` })),
    ...(/#\d+/.test(line.replace(/ \(#\d+\)$/, ""))
      ? [{ rule: "issue-number", message: "Issue numbers go in the PR body as Closes #N." }]
      : []),
    ...(/\bthis\s+commit\b/i.test(line)
      ? [{ rule: "this-commit", message: "Say what changed, not what this commit does." }]
      : []),
  ];
}

function bodyLineFindings(line: string): LineFinding[] {
  return [
    ...(/^#{1,6}\s/.test(line)
      ? [{ rule: "body-heading", message: "A commit body has no headings." }]
      : []),
    ...(/^\s*[-*] \[[ xX]\]/.test(line)
      ? [{ rule: "body-checkbox", message: "A commit body has no checklists." }]
      : []),
  ];
}

/** Checks a commit message or a PR title: every text rule plus the rules for messages. */
export function createMessageScanner(
  lists: WordLists,
): (where: string, message: string) => readonly Finding[] {
  const scanText = createTextScanner(lists);
  return (where, message) => {
    const lines = message.split("\n");
    const extra = lines.flatMap((line, index) =>
      [...messageLineFindings(line, lists), ...(index === 0 ? [] : bodyLineFindings(line))].map(
        (item) => place(item, where, index + 1),
      ),
    );
    return [...scanText(where, message), ...extra];
  };
}
