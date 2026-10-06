import { basename } from "node:path";
import { decisionId, decisionsPath, type AdrProblem, type DecisionRow } from "./decision-page.mjs";
import type { RecordFile } from "./record-files.mjs";

// The log closed at 0097 when the repository opened; every later decision is a record file.
const logEnd = 97;

function at(row: DecisionRow): string {
  return `${decisionsPath}:${String(row.line)}`;
}

function logProblems(rows: readonly DecisionRow[]): AdrProblem[] {
  const log = rows.filter((row) => row.table === "log");
  const wrong = log.findIndex((row, index) => row.number !== index + 1);
  if (wrong !== -1) {
    const row = log[wrong];
    const found = row === undefined ? "" : decisionId(row.number);
    return [
      {
        where: row === undefined ? decisionsPath : at(row),
        message: `the log holds decisions 0001 to ${decisionId(logEnd)} in order; ${decisionId(wrong + 1)} is due here, not ${found}.`,
      },
    ];
  }
  return log.length === logEnd
    ? []
    : [
        {
          where: decisionsPath,
          message: `the log holds decisions 0001 to ${decisionId(logEnd)}; it has ${String(log.length)} rows.`,
        },
      ];
}

function recordNumberProblems(records: readonly RecordFile[]): AdrProblem[] {
  return records
    .map((record, index) => ({ record, expected: logEnd + 1 + index }))
    .filter(({ record, expected }) => record.number !== expected)
    .slice(0, 1)
    .map(({ record, expected }) => ({
      where: record.path,
      message: `record numbers run from ${decisionId(logEnd + 1)} with no gap or repeat; ${decisionId(expected)} is due here.`,
    }));
}

function duplicateProblems(rows: readonly DecisionRow[]): AdrProblem[] {
  const seen = new Set<number>();
  return rows.flatMap((row) => {
    const repeated = seen.has(row.number);
    seen.add(row.number);
    return repeated
      ? [{ where: at(row), message: `${decisionId(row.number)} appears twice on the page.` }]
      : [];
  });
}

function rowForRecord(record: RecordFile, row: DecisionRow | undefined): AdrProblem[] {
  if (row === undefined) {
    return [
      {
        where: record.path,
        message: `${decisionId(record.number)} is not listed in ${decisionsPath}.`,
      },
    ];
  }
  const link = `(adr/${basename(record.path)})`;
  return [
    ...(row.status === record.status
      ? []
      : [
          {
            where: at(row),
            message: `the row says ${row.status}; ${record.path} says ${record.status}.`,
          },
        ]),
    ...((row.cells[3] ?? "").endsWith(link)
      ? []
      : [{ where: at(row), message: `the row links to its record with ${link}.` }]),
  ];
}

function indexProblems(rows: readonly DecisionRow[], records: readonly RecordFile[]): AdrProblem[] {
  const index = rows.filter((row) => row.table === "records");
  const numbers = new Set(records.map((record) => record.number));
  return [
    ...records.flatMap((record) =>
      rowForRecord(
        record,
        index.find((row) => row.number === record.number),
      ),
    ),
    ...index
      .filter((row) => !numbers.has(row.number))
      .map((row) => ({
        where: at(row),
        message: `${decisionId(row.number)} has no record file in docs/adr.`,
      })),
  ];
}

/** Numbering: the log runs 0001 to 0097, records from 0098, each number listed once. */
export function numberingProblems(
  rows: readonly DecisionRow[],
  records: readonly RecordFile[],
): AdrProblem[] {
  return [
    ...logProblems(rows),
    ...recordNumberProblems(records),
    ...duplicateProblems(rows),
    ...indexProblems(rows, records),
  ];
}
