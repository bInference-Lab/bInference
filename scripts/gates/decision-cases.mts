import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { failingCase, type GateCase } from "./gate-case.mjs";

const recordPath = "docs/adr/0098-sign-in-the-wallet-queue.md";
const allHeadings = ["Context", "Decision", "Consequences", "Alternatives"];

function recordText(status: string, headings: readonly string[] = allHeadings): string {
  const sections = headings.flatMap((heading) => [`## ${heading}`, "", `The ${heading}.`, ""]);
  return ["# 0098. Sign in the wallet queue", "", `Status: ${status}`, "", ...sections].join("\n");
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

function structureCases(page: string): readonly GateCase[] {
  return [
    failingCase(
      "a record missing from DECISIONS.md fails check:adr",
      { [recordPath]: recordText("Proposed") },
      ["check:adr", /0098 is not listed in docs\/DECISIONS\.md/],
    ),
    failingCase(
      "a record without its four headings fails check:adr",
      {
        [recordPath]: recordText("Proposed", allHeadings.slice(0, 3)),
        "docs/DECISIONS.md": page + indexRow("0098", "Proposed"),
      },
      ["check:adr", /a record has the headings/],
    ),
    failingCase(
      "a gap in the record numbers fails check:adr",
      {
        "docs/adr/0099-sign-in-the-wallet-queue.md": recordText("Proposed").replace("0098", "0099"),
        "docs/DECISIONS.md": page + indexRow("0099", "Proposed"),
      },
      ["check:adr", /0098 is due here/],
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

function recordLockCases(page: string): readonly GateCase[] {
  const accepted = {
    [recordPath]: recordText("Accepted"),
    "docs/DECISIONS.md": page + indexRow("0098", "Accepted"),
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
          output: [/0098's text changed/],
          files: {
            [recordPath]: recordText("Accepted").replace("The Decision.", "Another decision."),
          },
        },
      ],
    },
    {
      name: "superseding an accepted decision passes check:adr",
      files: {
        ...accepted,
        "docs/DECISIONS.md":
          withCell(page, "0005", [4, "Superseded by 0098"]) + indexRow("0098", "Accepted"),
      },
      steps: [{ command: ["pnpm", "check:adr", "--write"], expect: "pass" }],
    },
  ];
}

/** Cases for check:adr: numbering, the four headings, the index and the hash lock. */
export function decisionCases(repo: string): readonly GateCase[] {
  const page = readFileSync(join(repo, "docs/DECISIONS.md"), "utf8");
  const lock = readFileSync(join(repo, "docs/decisions.lock.json"), "utf8");
  return [...structureCases(page), ...lockCases(page, lock), ...recordLockCases(page)];
}
