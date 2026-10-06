/** One English term and every Chinese word the glossary gives it, all senses together. */
export interface GlossaryTerm {
  /** The English term in lower case, such as `network fee`. */
  readonly english: string;
  readonly chinese: readonly string[];
}

/** A cell split on its commas: the items outside brackets, and the items of its one bracket. */
interface CellParts {
  readonly items: readonly string[];
  readonly bracket: readonly string[];
}

const sectionHeading = "## Chinese terms";
// Brackets in a cell, ASCII or full-width.
const opening = new Set(["(", String.fromCodePoint(0xff08)]);
const closing = new Set([")", String.fromCodePoint(0xff09)]);

function sectionLines(markdown: string): readonly string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(sectionHeading);
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

function listItems(text: string): readonly string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

// "approve (an agent, an order), approval" has two items: the bracket's commas do not count.
function splitCell(cell: string): CellParts {
  let depth = 0;
  let outside = "";
  let inside = "";
  for (const character of cell) {
    if (opening.has(character)) {
      depth += 1;
    } else if (closing.has(character)) {
      depth = Math.max(0, depth - 1);
      inside += depth === 0 ? "\n" : character;
    } else if (depth === 0) {
      outside += character;
    } else {
      inside += character;
    }
  }
  const groups = inside.split("\n").filter((group) => group.trim() !== "");
  return { items: listItems(outside), bracket: groups.length === 1 ? listItems(inside) : [] };
}

// Lists of the same length pair item by item; otherwise each English item takes every Chinese
// one, as in "network fee, gas" for one Chinese word.
function pairs(
  english: readonly string[],
  chinese: readonly string[],
): readonly (readonly [string, string])[] {
  if (english.length === chinese.length) {
    return english.flatMap((term, index) => {
      const rendering = chinese[index];
      return rendering === undefined ? [] : [[term, rendering] as const];
    });
  }
  return english.flatMap((term) => chinese.map((rendering) => [term, rendering] as const));
}

function rowPairs(line: string): readonly (readonly [string, string])[] {
  const [english, chinese] = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  if (english === undefined || chinese === undefined || english.trim() === "English") {
    return [];
  }
  if (/^\s*:?-+:?\s*$/.test(english)) {
    return [];
  }
  const englishParts = splitCell(english);
  const chineseParts = splitCell(chinese);
  const brackets =
    englishParts.bracket.length > 0 && englishParts.bracket.length === chineseParts.bracket.length
      ? pairs(englishParts.bracket, chineseParts.bracket)
      : [];
  return [...pairs(englishParts.items, chineseParts.items), ...brackets];
}

/**
 * Reads the term tables under "Chinese terms" in `docs/GLOSSARY.md`. A bracket in a cell names
 * a sense and is dropped, unless both cells have one with the same number of items, as in
 * "brakes (pause, resume, stop)". Returns no terms when the section is missing.
 */
export function parseGlossary(markdown: string): readonly GlossaryTerm[] {
  const byTerm = new Map<string, Set<string>>();
  const rows = sectionLines(markdown).filter((line) => line.trimStart().startsWith("|"));
  for (const [english, chinese] of rows.flatMap((line) => rowPairs(line))) {
    const key = english.toLowerCase();
    byTerm.set(key, new Set([...(byTerm.get(key) ?? []), chinese]));
  }
  return [...byTerm].map(([english, chinese]: readonly [string, ReadonlySet<string>]) => ({
    english,
    chinese: [...chinese],
  }));
}
