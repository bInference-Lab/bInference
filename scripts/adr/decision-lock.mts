import { createHash } from "node:crypto";
import { z } from "zod";
import { decisionId, decisionsPath, type AdrProblem, type DecisionRow } from "./decision-page.mjs";
import { statusLine, type RecordFile } from "./record-files.mjs";

/** Where the hashes of accepted decisions live. */
export const lockPath = "docs/decisions.lock.json";

const entrySchema = z.strictObject({
  status: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const lockSchema = z.strictObject({
  decisions: z.record(z.string().regex(/^\d{4}$/), entrySchema),
});

/** The lock file: per decision number, the status and text hash it was accepted with. */
export type DecisionLock = z.infer<typeof lockSchema>;

/** An accepted decision as the lock sees it. */
export interface Lockable {
  readonly id: string;
  readonly where: string;
  readonly status: string;
  readonly sha256: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// A log row is locked without its status cell, so that cell alone may change.
function rowLockable(row: DecisionRow): Lockable {
  const locked = row.cells.filter((_, index) => index !== 4);
  return {
    id: decisionId(row.number),
    where: `${decisionsPath}:${String(row.line)}`,
    status: row.status,
    sha256: sha256(JSON.stringify(locked)),
  };
}

// A record is locked without its status line, and trailing spaces never count.
function recordLockable(record: RecordFile): Lockable {
  const body = record.text
    .replace(statusLine, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return {
    id: decisionId(record.number),
    where: record.path,
    status: record.status,
    sha256: sha256(body),
  };
}

/** Every log row, and every record past Proposed, is locked. */
export function lockables(
  rows: readonly DecisionRow[],
  records: readonly RecordFile[],
): Lockable[] {
  return [
    ...rows.filter((row) => row.table === "log").map(rowLockable),
    ...records.filter((record) => record.status !== "Proposed").map(recordLockable),
  ];
}

/** Parses the lock file's text; an absent file is an empty lock. */
export function parseLock(text: string | undefined): DecisionLock {
  if (text === undefined) {
    return { decisions: {} };
  }
  const parsed = lockSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`${lockPath} does not match its shape:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

const successor = /^(?:Superseded|Amended) by \d{4}$/;

function entryProblems(item: Lockable, lock: DecisionLock): AdrProblem[] {
  const entry = lock.decisions[item.id];
  if (entry === undefined) {
    return [
      {
        where: item.where,
        message: `${item.id} is accepted but not locked; run pnpm check:adr --write.`,
      },
    ];
  }
  return [
    ...(entry.sha256 === item.sha256
      ? []
      : [
          {
            where: item.where,
            message: `${item.id}'s text changed after it was accepted; a decision changes only through a new one that supersedes or amends it.`,
          },
        ]),
    ...(item.status === entry.status || successor.test(item.status)
      ? []
      : [
          {
            where: item.where,
            message: `${item.id}'s status was ${entry.status}; it may change only to Superseded by NNNN or Amended by NNNN.`,
          },
        ]),
  ];
}

// Entries at the merge base never change or go, so an edit cannot carry its own new hash.
function baseProblems(lock: DecisionLock, base: DecisionLock): AdrProblem[] {
  return Object.entries(base.decisions)
    .filter(([id, entry]) => {
      const now = lock.decisions[id];
      return now === undefined || now.sha256 !== entry.sha256 || now.status !== entry.status;
    })
    .map(([id]) => ({
      where: lockPath,
      message: `the entry for ${id} changed or went; locked entries never change.`,
    }));
}

/** Problems between the accepted decisions, the lock and the lock at the merge base. */
export function lockProblems(
  items: readonly Lockable[],
  lock: DecisionLock,
  base: DecisionLock,
): AdrProblem[] {
  const ids = new Set(items.map((item) => item.id));
  return [
    ...items.flatMap((item) => entryProblems(item, lock)),
    ...Object.keys(lock.decisions)
      .filter((id) => !ids.has(id))
      .map((id) => ({
        where: lockPath,
        message: `${id} is locked but is no longer an accepted decision.`,
      })),
    ...baseProblems(lock, base),
  ];
}

/** The lock with an entry added for each accepted decision it lacks; entries never change. */
export function withNewEntries(items: readonly Lockable[], lock: DecisionLock): DecisionLock {
  const added: [string, DecisionLock["decisions"][string]][] = items
    .filter((item) => lock.decisions[item.id] === undefined)
    .map((item) => [item.id, { status: item.status, sha256: item.sha256 }]);
  const decisions = Object.fromEntries(
    [...Object.entries(lock.decisions), ...added].toSorted(([a], [b]) => a.localeCompare(b)),
  );
  return { decisions };
}
