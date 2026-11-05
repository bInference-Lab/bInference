/** A model's text with its reasoning sections taken out. */
export interface TaggedSplit {
  /** What the owner reads: the text outside every reasoning section. */
  readonly text: string;
  /** What the reasoning sections held, outside private ones, a blank line apart. */
  readonly reasoning: string;
  /** Whether the text ends inside a section or in a tag still being written. */
  readonly isOpen: boolean;
}

/** A start or end of a section, outside code. */
interface Tag {
  readonly at: number;
  readonly end: number;
  readonly kind: "open" | "close" | "single";
  /** A `final` tag wraps the answer itself: it goes, its words stay. */
  readonly isWrap: boolean;
  /** A private section is dropped, never shown as reasoning. */
  readonly isPrivate: boolean;
}

interface Region {
  readonly start: number;
  readonly end: number;
}

const sectionNames =
  "(?:(?:antml:|mm:)?(?:thinking|think|thought|reasoning)|antthinking|internal|final)";
// A tag may hold spaces and attributes, quoted values among them, and may close itself.
const tagPattern = new RegExp(
  String.raw`<\s*(\/?)\s*(${sectionNames})(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'"<>])*?)(\/?)\s*>`,
  "giu",
);
const fenceLine = /^ {0,3}(`{3,}|~{3,})/u;
// The longest tag start held back while a stream writes it.
const maxPendingTag = 64;
const tagStart = /^<\s*\/?\s*[a-z:]*$/iu;
const namePrefixes = [
  "think",
  "thinking",
  "thought",
  "reasoning",
  "antthinking",
  "internal",
  "final",
];

function fencedRegions(text: string): Region[] {
  const regions: Region[] = [];
  let offset = 0;
  let open: { start: number; marks: string } | undefined;
  for (const line of text.split("\n")) {
    const marks = fenceLine.exec(line)?.[1];
    if (open === undefined && marks !== undefined) {
      open = { start: offset, marks };
    } else if (open !== undefined && marks !== undefined && isClosing(marks, open.marks, line)) {
      regions.push({ start: open.start, end: offset + line.length });
      open = undefined;
    }
    offset += line.length + 1;
  }
  return open === undefined ? regions : [...regions, { start: open.start, end: text.length }];
}

function isClosing(marks: string, opening: string, line: string): boolean {
  return (
    marks.startsWith(opening.charAt(0)) && marks.length >= opening.length && line.trim() === marks
  );
}

function isInside(at: number, regions: readonly Region[]): boolean {
  return regions.some((region) => at >= region.start && at < region.end);
}

// Code spans: a run of backticks closed by the next run of the same length in the same paragraph.
function spanRegions(text: string, fences: readonly Region[]): Region[] {
  const regions: Region[] = [];
  const runs = [...text.matchAll(/`+/gu)].filter((run) => !isInside(run.index, fences));
  let at = 0;
  while (at < runs.length) {
    const run = runs[at];
    const closing = runs.findIndex(
      (other, index) =>
        index > at &&
        other[0].length === run?.[0].length &&
        !text.slice(run.index, other.index).includes("\n\n"),
    );
    if (run === undefined || closing === -1) {
      at += 1;
      continue;
    }
    const close = runs[closing];
    regions.push({ start: run.index, end: (close?.index ?? 0) + (close?.[0].length ?? 0) });
    at = closing + 1;
  }
  return regions;
}

function codeRegions(text: string): readonly Region[] {
  const fences = fencedRegions(text);
  return [...fences, ...spanRegions(text, fences)];
}

function tagKind(slash: string): Tag["kind"] {
  return slash === "/" ? "close" : "open";
}

function tagsOf(text: string): readonly Tag[] {
  let code: readonly Region[] | undefined;
  const tags: Tag[] = [];
  for (const match of text.matchAll(tagPattern)) {
    code ??= codeRegions(text);
    if (isInside(match.index, code)) {
      continue;
    }
    const [whole, slash = "", name = "", , selfClose = ""] = match;
    const lower = name.toLowerCase();
    const kind = selfClose === "/" ? "single" : tagKind(slash);
    const isWrap = lower === "final";
    tags.push({
      at: match.index,
      end: match.index + whole.length,
      kind,
      isWrap,
      isPrivate: lower === "internal",
    });
  }
  return tags;
}

// A tail like `<thi` that may grow into a tag: a stream holds it back until it does or does not.
function pendingStart(text: string): number | undefined {
  const at = text.lastIndexOf("<");
  const tail = text.slice(at);
  if (at === -1 || tail.length > maxPendingTag || !tagStart.test(tail)) {
    return undefined;
  }
  const name = tail.replace(/^<\s*\/?\s*/u, "").toLowerCase();
  const fits = namePrefixes.some(
    (prefix) =>
      prefix.startsWith(name.replace(/^(?:antml:|mm:)/u, "")) ||
      "antml:".startsWith(name) ||
      "mm:".startsWith(name),
  );
  return fits ? at : undefined;
}

/** Walks the tags of a text in order, sorting its words into shown and reasoning. */
interface Walk {
  step(tag: Tag): void;
  /** Ends the walk at the end of the text, as the final split or a stream's split so far. */
  end(options: { readonly isFinal: boolean }): TaggedSplit;
}

function createWalk(text: string): Walk {
  const reasoning: string[] = [];
  let [depth, privateDepth, cursor, tagsSeen, shown] = [0, 0, 0, 0, ""];
  const take = (words: string): void => {
    if (depth === 0) {
      shown += words;
    } else if (privateDepth === 0 && words.trim() !== "") {
      reasoning.push(words.trim());
    }
  };
  const close = (words: string): void => {
    if (depth === 0) {
      // A close with no open: the words since the last tag were reasoning whose start was lost.
      reasoning.push(...(words.trim() === "" ? [] : [words.trim()]));
      return;
    }
    take(words);
    privateDepth = Math.max(0, privateDepth - 1);
    depth -= 1;
  };
  const open = (tag: Tag, words: string): void => {
    take(words);
    depth += 1;
    privateDepth += tag.isPrivate || privateDepth > 0 ? 1 : 0;
  };
  return {
    step(tag) {
      const words = text.slice(cursor, tag.at);
      cursor = tag.end;
      const isSection = !tag.isWrap && tag.kind !== "single";
      tagsSeen += isSection ? 1 : 0;
      const move = isSection && tag.kind === "open" ? (said: string) => open(tag, said) : close;
      (isSection ? move : take)(words);
    },
    end({ isFinal }) {
      const rest = text.slice(cursor);
      const isWhole = depth === 1 && tagsSeen === 1 && privateDepth === 0 && shown.trim() === "";
      if (isFinal && isWhole) {
        return { text: rest.trim(), reasoning: "", isOpen: false };
      }
      take(rest);
      const joined = reasoning.join("\n\n");
      return { text: isFinal ? shown.trim() : shown, reasoning: joined, isOpen: depth > 0 };
    },
  };
}

/**
 * Splits a model's text into what the owner reads and the reasoning a model wrote inline:
 * sections in `<think>`, `<thinking>`, `<thought>`, `<reasoning>`, `<antthinking>`, their `antml:`
 * and `mm:` forms, and `<internal>`, which is dropped. Names match in any case, with spaces and
 * attributes; sections nest; a `final` tag goes and its words stay; a close with no open makes the
 * words before it reasoning. A tag inside a fenced code block or a code span stays text. A text
 * still being streamed (`isFinal` false) holds back a tail that may grow into a tag, and the words
 * of a section not closed yet are reasoning. At the end a section never closed is reasoning, unless
 * it held the whole text with no other tag, which then shows. The final text is trimmed.
 */
export function splitReasoningTags(
  text: string,
  options: { readonly isFinal: boolean },
): TaggedSplit {
  if (!text.includes("<")) {
    return { text, reasoning: "", isOpen: false };
  }
  const pending = options.isFinal ? undefined : pendingStart(text);
  const scanned = pending === undefined ? text : text.slice(0, pending);
  const walk = createWalk(scanned);
  for (const tag of tagsOf(scanned)) {
    walk.step(tag);
  }
  const split = walk.end(options);
  return pending === undefined ? split : { ...split, isOpen: true };
}
