import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixturePackage } from "./fixture-package.mjs";
import type { GateCase } from "./gate-case.mjs";

interface PrCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly commit: string;
  readonly body: string;
  readonly branch?: string;
  readonly expect: "pass" | "fail";
  readonly output: RegExp;
}

const filled = [
  "## Problem",
  "",
  "The notes were missing.",
  "",
  "## Impact",
  "",
  "Readers find the notes.",
  "",
  "## Evidence",
  "",
  "pnpm check passes.",
  "",
].join("\n");

function moneyChecklist(repo: string): string {
  const template = readFileSync(join(repo, ".github/pull_request_template.md"), "utf8");
  const start = template.indexOf("## Money path");
  const end = template.indexOf("## Dependencies");
  return template.slice(start, end).replaceAll("- [ ]", "- [x]");
}

function prCase(item: PrCase): GateCase {
  return {
    name: item.name,
    files: item.files,
    commitAs: item.commit,
    steps: [
      {
        command: ["pnpm", "check:pr"],
        expect: item.expect,
        output: [item.output],
        env: {
          PR_TITLE: item.commit,
          PR_BODY: item.body,
          PR_BRANCH: item.branch ?? "docs/notes",
          PR_BASE_SHA: "HEAD~1",
          PR_HEAD_SHA: "HEAD",
        },
      },
    ],
  };
}

const notes = { "notes.md": "# Notes\n\nThe gates fail on planted violations.\n" };
const engine = fixturePackage("engine", { "rule.ts": "export const rule: number = 1;\n" });

function bodyCases(repo: string): readonly GateCase[] {
  return [
    prCase({
      name: "a complete PR passes check:pr",
      files: notes,
      commit: "docs: add notes about the gates",
      body: filled,
      expect: "pass",
      output: /ready for review/,
    }),
    prCase({
      name: "an empty evidence section fails check:pr",
      files: notes,
      commit: "docs: add notes about the gates",
      body: filled.replace("pnpm check passes.", "<!-- The commands you ran. -->"),
      expect: "fail",
      output: /filled "## Evidence" section/,
    }),
    prCase({
      name: "a PR touching engine without the money-path checklist fails check:pr",
      files: engine,
      commit: "feat(engine): add the first rule",
      body: filled,
      branch: "feat/first-rule",
      expect: "fail",
      output: /tick every "## Money path" line/,
    }),
    prCase({
      name: "a PR touching engine with the money-path checklist ticked passes check:pr",
      files: engine,
      commit: "feat(engine): add the first rule",
      body: `${filled}\n${moneyChecklist(repo)}`,
      branch: "feat/first-rule",
      expect: "pass",
      output: /ready for review/,
    }),
  ];
}

/** Cases for check:pr, which CI runs on the title, body, branch and commits of a PR. */
export function prCases(repo: string): readonly GateCase[] {
  return [
    ...bodyCases(repo),
    prCase({
      name: "a branch not named <type>/<short-name> fails check:pr",
      files: notes,
      commit: "docs: add notes about the gates",
      body: filled,
      branch: "notes",
      expect: "fail",
      output: /not named <type>\/<short-name>/,
    }),
    prCase({
      name: "a dependency change without a dependencies section fails check:pr",
      files: {
        "package.json": readFileSync(join(repo, "package.json"), "utf8").replace(
          '"devDependencies": {',
          '"devDependencies": {\n    "left-pad": "catalog:",',
        ),
      },
      commit: "build: add a padding library",
      body: filled,
      branch: "build/padding",
      expect: "fail",
      output: /Dependencies changed/,
    }),
    prCase({
      name: "a PR over 400 lines gets a warning from check:pr",
      files: { "notes.md": `# Notes\n\n${"A line of notes.\n\n".repeat(230)}` },
      commit: "docs: add notes about the gates",
      body: filled,
      expect: "pass",
      output: /::warning::This PR changes \d+ lines/,
    }),
  ];
}
