import { displayOutsideText } from "@binference/i18n";
import {
  isBlankLine,
  isSameBlock,
  type RichLine,
  type RichMark,
  type RichRun,
  richLinesOf,
} from "@binference/rich-text";
import type { ReactNode } from "react";

/** Lines of one block in a row: a paragraph, a quote or a code block. */
interface Group {
  readonly lines: readonly RichLine[];
}

// The lines in blocks: a quote or a code block holds its lines, and a blank line ends a paragraph.
function groupsOf(lines: readonly RichLine[]): readonly Group[] {
  const groups: RichLine[][] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    const isBreak = isBlankLine(line);
    if (isBreak) {
      groups.push([]);
    } else if (
      last !== undefined &&
      last.length > 0 &&
      isSameBlock(last[0]?.block ?? line.block, line.block)
    ) {
      last.push(line);
    } else {
      groups.push([line]);
    }
  }
  return groups.filter((group) => group.length > 0).map((held) => ({ lines: held }));
}

type SimpleMark = Exclude<RichMark["kind"], "link">;

// Each style but a link, around what it holds.
const simpleMarks: Readonly<Record<SimpleMark, (inner: ReactNode, key: number) => ReactNode>> = {
  bold: (inner, key) => (
    <strong key={key} className="font-semibold">
      {inner}
    </strong>
  ),
  italic: (inner, key) => <em key={key}>{inner}</em>,
  strike: (inner, key) => <s key={key}>{inner}</s>,
  code: (inner, key) => (
    <code key={key} className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
      {inner}
    </code>
  ),
  spoiler: (inner, key) => (
    <span
      key={key}
      className="rounded bg-muted text-transparent transition-colors hover:text-inherit"
    >
      {inner}
    </span>
  ),
};

// One style around what it holds; a link opens in a new tab, its address only `http:` or `https:`,
// which the reader already checked.
function marked(mark: RichMark, inner: ReactNode, key: number): ReactNode {
  if (mark.kind !== "link") {
    return simpleMarks[mark.kind](inner, key);
  }
  return (
    <a
      key={key}
      href={mark.href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {inner}
    </a>
  );
}

// A run's text with each character a reader cannot see written out, inside its styles.
function runOf(run: RichRun, key: number): ReactNode {
  const text = displayOutsideText(run.text, Number.POSITIVE_INFINITY);
  return run.marks.toReversed().reduce<ReactNode>((inner, mark) => marked(mark, inner, key), text);
}

function lineOf(line: RichLine, key: number): ReactNode {
  return <span key={key}>{line.runs.map((run, at) => runOf(run, at))}</span>;
}

// A block's lines, one under the other.
function linesOf(group: Group): ReactNode {
  return group.lines.flatMap((line, at) =>
    at === 0 ? [lineOf(line, at)] : [<br key={`b${String(at)}`} />, lineOf(line, at)],
  );
}

function blockOf(group: Group, key: number): ReactNode {
  const kind = group.lines[0]?.block.kind ?? "text";
  if (kind === "quote") {
    return (
      <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">
        {linesOf(group)}
      </blockquote>
    );
  }
  if (kind === "code") {
    return (
      <pre
        key={key}
        className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed"
      >
        <code>
          {group.lines.map((line) => line.runs.map((run) => run.text).join("")).join("\n")}
        </code>
      </pre>
    );
  }
  return <p key={key}>{linesOf(group)}</p>;
}

/**
 * The agent's text as the console shows it (decision 0383): its Markdown read by the reader the
 * Telegram bot uses, then drawn as elements, never as HTML from the text: paragraphs, quotes, code
 * blocks, lists and tables as the reader draws them, bold, italic, struck, code, hidden and linked
 * runs. Each character a reader cannot see is written out.
 */
export function RichText(props: { readonly text: string }): React.JSX.Element {
  const groups = groupsOf(richLinesOf(props.text));
  return <div className="flex flex-col gap-2 break-words">{groups.map(blockOf)}</div>;
}
