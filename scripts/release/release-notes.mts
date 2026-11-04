import { notesWordsEn, type NotesWords } from "./notes-words.mjs";
import { notesWordsZh } from "./notes-words.zh.mjs";
import type { ReleaseTag } from "./release-tag.mjs";

/** One commit on `master`: its subject and its body. */
export interface ReleaseCommit {
  readonly subject: string;
  readonly body: string;
}

/** What the notes are written from: the release, where its changes start, and the commits. */
export interface NotesInput {
  readonly release: ReleaseTag;
  /** The tag or commit the changes start after; undefined for the first release. */
  readonly since: string | undefined;
  readonly commits: readonly ReleaseCommit[];
}

type GroupKey = "feat" | "fix" | "perf" | "other";

const groupKeys: readonly GroupKey[] = ["feat", "fix", "perf", "other"];

// Each of the notes' own words in English, then in Simplified Chinese; the subjects are English.
function both(pick: (words: NotesWords) => string): string {
  return `${pick(notesWordsEn)} · ${pick(notesWordsZh)}`;
}

const subjectPattern = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9-]+)\))?(?<bang>!)?: (?<text>.+)$/;

interface Line {
  readonly group: GroupKey;
  readonly breaking: boolean;
  readonly text: string;
}

function groupOf(type: string | undefined): GroupKey {
  return type === "feat" || type === "fix" || type === "perf" ? type : "other";
}

// The body paragraph that starts `Breaking:`, joined onto one line.
function breakingNote(body: string): string | undefined {
  const paragraph = body.split(/\n\s*\n/).find((part) => part.trimStart().startsWith("Breaking:"));
  return paragraph?.trim().replace(/\s*\n\s*/g, " ");
}

function lineOf(commit: ReleaseCommit): Line {
  const parts = subjectPattern.exec(commit.subject)?.groups ?? {};
  const { type, scope, bang, text = commit.subject } = parts;
  const breaking = bang === "!";
  const line = scope === undefined ? text : `**${scope}**: ${text}`;
  const note = breaking ? breakingNote(commit.body) : undefined;
  return { group: groupOf(type), breaking, text: note === undefined ? line : `${line}. ${note}` };
}

function section(heading: string, items: readonly string[]): readonly string[] {
  return items.length === 0 ? [] : [`## ${heading}`, "", ...items.map((item) => `- ${item}`), ""];
}

function header(input: NotesInput): readonly string[] {
  const { release, since, commits } = input;
  const count = String(commits.length);
  const range =
    since === undefined
      ? both((words) => words.first(count))
      : both((words) => words.since(count, since));
  return [`# binference ${release.version}`, "", `\`${release.channel}\` · ${range}`, ""];
}

/**
 * The release notes, written from the commit subjects on `master` (ENGINEERING section 19):
 * breaking changes first with their `Breaking:` paragraph, then new features, fixes, speed and
 * the rest. The first release counts its commits instead of listing them.
 */
export function releaseNotes(input: NotesInput): string {
  if (input.since === undefined) {
    return `${header(input).join("\n").trimEnd()}\n`;
  }
  const lines = input.commits.map(lineOf);
  const body = [
    ...section(
      both((words) => words.breaking),
      lines.filter((line) => line.breaking).map((line) => line.text),
    ),
    ...groupKeys.flatMap((key) =>
      section(
        both((words) => words[key]),
        lines.filter((line) => line.group === key && !line.breaking).map((line) => line.text),
      ),
    ),
  ];
  return `${[...header(input), ...body].join("\n").trimEnd()}\n`;
}
