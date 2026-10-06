import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AdrProblem } from "./decision-page.mjs";

/** One decision record file under docs/adr. */
export interface RecordFile {
  readonly number: number;
  /** The path from the repo root, such as docs/adr/0098-sign-in-the-wallet-queue.md. */
  readonly path: string;
  readonly text: string;
  readonly status: string;
}

// Where decision record files live.
const recordFolder = "docs/adr";

const recordName = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const headings = ["## Context", "## Decision", "## Consequences", "## Alternatives"];

/** The line that holds a record's status. */
export const statusLine = /^Status: (.+)$/m;

function headingProblems(file: RecordFile): AdrProblem[] {
  const found = file.text.split("\n").filter((line) => line.startsWith("## "));
  const inOrder = found.length === headings.length && found.every((h, i) => h === headings[i]);
  return inOrder
    ? []
    : [
        {
          where: file.path,
          message: `a record has the headings ${headings.join(", ")}, once each and in that order.`,
        },
      ];
}

function titleProblems(file: RecordFile): AdrProblem[] {
  const title = new RegExp(`^# ${String(file.number).padStart(4, "0")}\\. \\S`);
  return [
    ...(title.test(file.text)
      ? []
      : [{ where: file.path, message: "the first line reads # NNNN. Title." }]),
    ...(file.status.length > 0
      ? []
      : [{ where: file.path, message: "a record holds a Status: line." }]),
  ];
}

/** The structural problems of one record: its title line, status line and four headings. */
export function recordProblems(file: RecordFile): AdrProblem[] {
  return [...titleProblems(file), ...headingProblems(file)];
}

/** Reads the record files among the repo files; anything else in docs/adr is a problem. */
export function readRecords(
  root: string,
  files: readonly string[],
): { readonly records: readonly RecordFile[]; readonly problems: readonly AdrProblem[] } {
  const inFolder = files.filter((file) => file.startsWith(`${recordFolder}/`));
  const records: RecordFile[] = [];
  const problems: AdrProblem[] = [];
  for (const path of inFolder) {
    const match = recordName.exec(basename(path));
    if (match === null || path !== `${recordFolder}/${basename(path)}`) {
      problems.push({
        where: path,
        message: `${recordFolder} holds only records named NNNN-title.md.`,
      });
      continue;
    }
    const text = readFileSync(join(root, path), "utf8");
    const status = statusLine.exec(text)?.[1]?.trim() ?? "";
    records.push({ number: Number(match[1]), path, text, status });
  }
  return { records: records.toSorted((a, b) => a.number - b.number), problems };
}
