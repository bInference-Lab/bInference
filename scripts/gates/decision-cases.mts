import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { failingCase, type GateCase } from "./gate-case.mjs";

const allHeadings = ["Context", "Decision", "Consequences", "Alternatives"];

// The planted record takes the next free number, so real records never collide with it.
interface Planted {
  readonly next: string;
  readonly gap: string;
}

function fourDigits(value: number): string {
  return String(value).padStart(4, "0");
}

function nextNumbers(page: string): Planted {
  const numbers = [...page.matchAll(/<a id="d(\d{4})"><\/a>/g)].map((match) => Number(match[1]));
  const last = Math.max(0, ...numbers);
  return { next: fourDigits(last + 1), gap: fourDigits(last + 2) };
}

function recordPath(number: string): string {
  return `docs/adr/${number}-sign-in-the-wallet-queue.md`;
}

function recordText(
  number: string,
  status: string,
  headings: readonly string[] = allHeadings,
): string {
  const sections = headings.flatMap((heading) => [`## ${heading}`, "", `The ${heading}.`, ""]);
  return [`# ${number}. Sign in the wallet queue`, "", `Status: ${status}`, "", ...sections].join(
    "\n",
  );
}

function indexRow(number: string, status: string): string {
  const file = `adr/${number}-sign-in-the-wallet-queue.md`;
  return `| <a id="d${number}"></a>${number} | Sign in the wallet queue | ${status} | [${file}](${file}) |\n`;
}

// Rewrites one cell of a log row; the page's table padding does not matter to check:adr.
function withCell(page: string, id: string, [column, value]: readonly [number, string]): string {
  return page
    .split("\n")
    .map((line) => {
      if (!line.startsWith(`| <a id="d${id}"></a>`)) {
        return line;
      }
      const cells = line.split("|").slice(1, -1);
      cells[column] = ` ${value} `;
      return `|${cells.join("|")}|`;
    })
    .join("\n");
}

function structureCases(page: string, { next, gap }: Planted): readonly GateCase[] {
  return [
    failingCase(
      "a record missing from DECISIONS.md fails check:adr",
      { [recordPath(next)]: recordText(next, "Proposed") },
      ["check:adr", new RegExp(`${next} is not listed in docs/DECISIONS\\.md`)],
    ),
    failingCase(
      "a record without its four headings fails check:adr",
      {
        [recordPath(next)]: recordText(next, "Proposed", allHeadings.slice(0, 3)),
        "docs/DECISIONS.md": page + indexRow(next, "Proposed"),
      },
      ["check:adr", /a record has the headings/],
    ),
    failingCase(
      "a gap in the record numbers fails check:adr",
      {
        [recordPath(gap)]: recordText(gap, "Proposed"),
        "docs/DECISIONS.md": page + indexRow(gap, "Proposed"),
      },
      ["check:adr", new RegExp(`${next} is due here`)],
    ),
  ];
}

function lockCases(page: string, lock: string): readonly GateCase[] {
  const edited = withCell(page, "0005", [2, "**A bot shared by every owner.**"]);
  const parsed = z
    .looseObject({ decisions: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(lock));
  const rest = Object.fromEntries(Object.entries(parsed.decisions).filter(([id]) => id !== "0005"));
  return [
    failingCase(
      "an edit to an accepted decision fails check:adr",
      { "docs/DECISIONS.md": edited },
      ["check:adr", /0005's text changed/],
    ),
    failingCase(
      "a status change other than Superseded or Amended fails check:adr",
      { "docs/DECISIONS.md": withCell(page, "0001", [4, "Accepted"]) },
      ["check:adr", /0001's status was Amended by 0086/],
    ),
    {
      name: "an edited decision with a new lock entry fails check:adr against the base",
      files: {
        "docs/DECISIONS.md": edited,
        "docs/decisions.lock.json": `${JSON.stringify({ decisions: rest }, null, 2)}\n`,
      },
      steps: [
        {
          command: ["pnpm", "check:adr", "--write"],
          expect: "fail",
          output: [/the entry for 0005 changed or went/],
          // The sandbox's own master is the base, whatever BASE_REF the run inherits.
          env: { BASE_REF: "master" },
        },
      ],
    },
  ];
}

function recordLockCases(page: string, { next }: Planted): readonly GateCase[] {
  const accepted = {
    [recordPath(next)]: recordText(next, "Accepted"),
    "docs/DECISIONS.md": page + indexRow(next, "Accepted"),
  };
  return [
    {
      name: "an edit to an accepted record fails check:adr",
      files: accepted,
      steps: [
        { command: ["pnpm", "check:adr", "--write"], expect: "pass" },
        {
          command: ["pnpm", "check:adr"],
          expect: "fail",
          output: [new RegExp(`${next}'s text changed`)],
          files: {
            [recordPath(next)]: recordText(next, "Accepted").replace(
              "The Decision.",
              "Another decision.",
            ),
          },
        },
      ],
    },
    {
      name: "superseding an accepted decision passes check:adr",
      files: {
        ...accepted,
        "docs/DECISIONS.md":
          withCell(page, "0005", [4, `Superseded by ${next}`]) + indexRow(next, "Accepted"),
      },
      steps: [{ command: ["pnpm", "check:adr", "--write"], expect: "pass" }],
    },
  ];
}

/** Cases for check:adr: numbering, the four headings, the index and the hash lock. */
export function decisionCases(repo: string): readonly GateCase[] {
  const page = readFileSync(join(repo, "docs/DECISIONS.md"), "utf8");
  const lock = readFileSync(join(repo, "docs/decisions.lock.json"), "utf8");
  const planted = nextNumbers(page);
  return [
    ...structureCases(page, planted),
    ...lockCases(page, lock),
    ...recordLockCases(page, planted),
  ];
}
