/** A problem check:adr reports, at a place in a file. */
export interface AdrProblem {
  readonly where: string;
  readonly message: string;
}

/** One table row of docs/DECISIONS.md that carries a decision number. */
export interface DecisionRow {
  readonly number: number;
  /** "log" for decisions 0001 to 0097, "records" for the index of record files. */
  readonly table: "log" | "records";
  /** The 1-based line in docs/DECISIONS.md. */
  readonly line: number;
  /** Trimmed cells, the number cell first, inner whitespace collapsed. */
  readonly cells: readonly string[];
  readonly status: string;
}

/** The parsed decisions page. */
export interface DecisionPage {
  readonly rows: readonly DecisionRow[];
  readonly problems: readonly AdrProblem[];
}

/** Where the decisions page lives. */
export const decisionsPath = "docs/DECISIONS.md";

const sections: Readonly<Record<string, "log" | "records">> = {
  "## The log": "log",
  "## Decision records": "records",
};
const statusColumn: Readonly<Record<"log" | "records", number>> = { log: 4, records: 2 };
const columnCount: Readonly<Record<"log" | "records", number>> = { log: 6, records: 4 };
const numberCell = /^<a id="d(\d{4})"><\/a>(\d{4})$/;

/** Formats a decision number the way the page writes it: four digits. */
export function decisionId(number: number): string {
  return String(number).padStart(4, "0");
}

function splitCells(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\s+/g, " "));
}

interface RowInput {
  readonly line: string;
  readonly index: number;
  readonly table: "log" | "records";
}

function parseRow(input: RowInput): DecisionRow | AdrProblem | undefined {
  const cells = splitCells(input.line);
  const where = `${decisionsPath}:${String(input.index + 1)}`;
  const first = cells[0] ?? "";
  if (!/\d{4}/.test(first)) {
    return undefined;
  }
  const match = numberCell.exec(first);
  if (match === null || match[1] !== match[2]) {
    return { where, message: `the number cell must read <a id="dNNNN"></a>NNNN, not ${first}.` };
  }
  if (cells.length !== columnCount[input.table]) {
    const count = String(columnCount[input.table]);
    return {
      where,
      message: `a row of this table has ${count} cells; this one has ${String(cells.length)}.`,
    };
  }
  return {
    number: Number(match[2]),
    table: input.table,
    line: input.index + 1,
    cells,
    status: cells[statusColumn[input.table]] ?? "",
  };
}

/** Reads every numbered row of the log and of the records index. */
export function parseDecisionPage(text: string): DecisionPage {
  const rows: DecisionRow[] = [];
  const problems: AdrProblem[] = [];
  let table: "log" | "records" | undefined;
  text.split("\n").forEach((line, index) => {
    if (line.startsWith("## ")) {
      table = sections[line.trim()];
      return;
    }
    if (table === undefined || !line.trimStart().startsWith("|")) {
      return;
    }
    const parsed = parseRow({ line, index, table });
    if (parsed !== undefined && "number" in parsed) {
      rows.push(parsed);
    } else if (parsed !== undefined) {
      problems.push(parsed);
    }
  });
  return { rows, problems };
}
