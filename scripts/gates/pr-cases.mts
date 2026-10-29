import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase } from "./gate-case.mjs";

interface PrCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly commit: string;
  /** The PR body, given with the commit as the title; without one, neither is passed. */
  readonly body?: string;
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

// The planted commit sits on the sandbox's master; a branch at it makes the range's head.
function prCase(item: PrCase): GateCase {
  const branch = item.branch ?? "docs/notes";
  const body = item.body === undefined ? [] : ["--body", ".gates/body.md"];
  const title = item.body === undefined ? [] : ["--title", item.commit];
  return {
    name: item.name,
    files: item.files,
    commitAs: item.commit,
    steps: [
      { command: ["git", "branch", "--force", branch, "HEAD"], expect: "pass" },
      {
        command: ["pnpm", "check:pr", `HEAD~1..${branch}`, ...title, ...body],
        files: item.body === undefined ? {} : { ".gates/body.md": item.body },
        expect: item.expect,
        output: [item.output],
      },
    ],
  };
}

const notes = { "notes.md": "# Notes\n\nThe gates fail on planted violations.\n" };
// A new file in the engine package; its manifest stays as it is, so no dependency changes.
const engine = { "packages/engine/src/rule.ts": "export const rule: number = 1;\n" };

function bodyCases(repo: string): readonly GateCase[] {
  return [
    prCase({
      name: "a complete PR passes check:pr",
      files: notes,
      commit: "docs: add notes about the gates",
      body: filled,
      expect: "pass",
      output: /ready to merge/,
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
      output: /ready to merge/,
    }),
  ];
}

/** Cases for check:pr, which the merger runs on a branch's range, commits and PR body. */
export function prCases(repo: string): readonly GateCase[] {
  return [
    ...bodyCases(repo),
    prCase({
      name: "a branch range with no body file passes check:pr and says the body went unchecked",
      files: notes,
      commit: "docs: add notes about the gates",
      expect: "pass",
      output: /PR body was not checked[\s\S]*ready to merge/,
    }),
    prCase({
      name: "a commit with a bad subject in the range fails check:pr",
      files: notes,
      commit: "docs: Added notes.",
      expect: "fail",
      output: /a commit fails commitlint/,
    }),
    prCase({
      name: "a branch not named <type>/<short-name> fails check:pr",
      files: notes,
      commit: "docs: add notes about the gates",
      body: filled,
      branch: "notes",
      expect: "fail",
      output: /not a branch named <type>\/<short-name>/,
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
      output: /the branch changes \d+ lines/,
    }),
  ];
}
