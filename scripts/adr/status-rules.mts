import { decisionId, decisionsPath, type AdrProblem, type DecisionRow } from "./decision-page.mjs";
import type { RecordFile } from "./record-files.mjs";

const successor = /^(?:Superseded|Amended) by (\d{4})$/;
const logStatuses = new Set(["Accepted"]);
const recordStatuses = new Set(["Proposed", "Accepted", "Rejected"]);

interface StatusOf {
  readonly number: number;
  readonly status: string;
  readonly where: string;
  readonly allowed: ReadonlySet<string>;
}

function statusProblem(item: StatusOf, known: ReadonlySet<number>): AdrProblem[] {
  const next = successor.exec(item.status);
  if (next === null) {
    return item.allowed.has(item.status)
      ? []
      : [
          {
            where: item.where,
            message: `status ${item.status} is not one of ${[...item.allowed].join(", ")}, Superseded by NNNN or Amended by NNNN.`,
          },
        ];
  }
  const later = Number(next[1]);
  return later > item.number && known.has(later)
    ? []
    : [
        {
          where: item.where,
          message: `${decisionId(item.number)} can only be superseded or amended by a later decision that exists.`,
        },
      ];
}

/** Each status is one the page allows, and a successor is a later decision that exists. */
export function statusProblems(
  rows: readonly DecisionRow[],
  records: readonly RecordFile[],
): AdrProblem[] {
  const known = new Set([
    ...rows.map((row) => row.number),
    ...records.map((record) => record.number),
  ]);
  const items: StatusOf[] = [
    ...rows
      .filter((row) => row.table === "log")
      .map((row) => ({
        number: row.number,
        status: row.status,
        where: `${decisionsPath}:${String(row.line)}`,
        allowed: logStatuses,
      })),
    ...records.map((record) => ({
      number: record.number,
      status: record.status,
      where: record.path,
      allowed: recordStatuses,
    })),
  ];
  return items.flatMap((item) => statusProblem(item, known));
}
