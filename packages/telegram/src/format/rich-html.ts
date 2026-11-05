import { escapeHtml } from "./escape-html.js";
import {
  isSameBlock,
  isSameMark,
  type RichBlock,
  type RichLine,
  type RichMark,
  type RichRun,
} from "./rich-line.js";

// The only tags the agent's text ever shows in, each with its fixed opening and closing.
const simpleTags = {
  bold: ["<b>", "</b>"],
  italic: ["<i>", "</i>"],
  strike: ["<s>", "</s>"],
  code: ["<code>", "</code>"],
} as const satisfies Record<string, readonly [string, string]>;

function openTag(mark: RichMark): string {
  return mark.kind === "link" ? `<a href="${escapeHtml(mark.href)}">` : simpleTags[mark.kind][0];
}

function closeTag(mark: RichMark): string {
  return mark.kind === "link" ? "</a>" : simpleTags[mark.kind][1];
}

/** The characters a run's tags add around its text, at most. */
export function marksLength(marks: readonly RichMark[]): number {
  return marks.reduce((total, mark) => total + openTag(mark).length + closeTag(mark).length, 0);
}

/** The opening and closing tags of a block: none for text, `blockquote`, or `pre` for code. */
export function blockTags(block: RichBlock): readonly [string, string] {
  if (block.kind === "text") {
    return ["", ""];
  }
  if (block.kind === "quote") {
    return ["<blockquote>", "</blockquote>"];
  }
  return block.language === undefined
    ? ["<pre>", "</pre>"]
    : [`<pre><code class="language-${block.language}">`, "</code></pre>"];
}

function sharedLength(open: readonly RichMark[], marks: readonly RichMark[]): number {
  let shared = 0;
  while (shared < open.length && shared < marks.length) {
    const [left, right] = [open[shared], marks[shared]];
    if (left === undefined || right === undefined || !isSameMark(left, right)) {
      break;
    }
    shared += 1;
  }
  return shared;
}

// A line's runs with each tag opened where its style starts and closed where it ends, so the
// line's tags always balance.
function lineHtml(runs: readonly RichRun[]): string {
  let html = "";
  let open: readonly RichMark[] = [];
  for (const run of runs.filter((given) => given.text !== "")) {
    const shared = sharedLength(open, run.marks);
    html += open.slice(shared).toReversed().map(closeTag).join("");
    html += run.marks.slice(shared).map(openTag).join("");
    html += escapeHtml(run.text);
    open = run.marks;
  }
  return html + open.toReversed().map(closeTag).join("");
}

/** Consecutive lines of one block, in order. */
function blocksOf(lines: readonly RichLine[]): readonly (readonly RichLine[])[] {
  const groups: RichLine[][] = [];
  for (const line of lines) {
    const group = groups.at(-1);
    const first = group?.[0];
    if (group !== undefined && first !== undefined && isSameBlock(first.block, line.block)) {
      group.push(line);
    } else {
      groups.push([line]);
    }
  }
  return groups;
}

/**
 * Renders lines as Telegram HTML from a fixed set of tags: `b`, `i`, `s`, `code`, `pre` with an
 * optional `language-` class of letters and digits, `a` with an `http:` or `https:` address, and
 * `blockquote`. Every text is escaped and every tag closes inside the lines given.
 */
export function richHtmlOf(lines: readonly RichLine[]): string {
  return blocksOf(lines)
    .map((group) => {
      const [open, close] = blockTags(group[0]?.block ?? { kind: "text" });
      return `${open}${group.map((line) => lineHtml(line.runs)).join("\n")}${close}`;
    })
    .join("\n");
}

function hrefOf(run: RichRun | undefined): string | undefined {
  for (const mark of run?.marks ?? []) {
    if (mark.kind === "link") {
      return mark.href;
    }
  }
  return undefined;
}

// A link's address follows its label, unless the label is the address itself.
function linePlain(runs: readonly RichRun[]): string {
  let text = "";
  let label = "";
  runs.forEach((run, index) => {
    const href = hrefOf(run);
    text += run.text;
    label = href !== undefined && href === hrefOf(runs[index - 1]) ? label + run.text : run.text;
    if (href !== undefined && href !== hrefOf(runs[index + 1]) && label !== href) {
      text += ` (${href})`;
    }
  });
  return text;
}

/**
 * The same lines as plain text, for a message sent with no parse mode: no tags and no escapes,
 * with each link's address after its label.
 */
export function richPlainOf(lines: readonly RichLine[]): string {
  return lines.map((line) => linePlain(line.runs)).join("\n");
}
