import { fixturePackage } from "./fixture-package.mjs";
import type { GateCase, GateStep } from "./gate-case.mjs";

function commitlint(message: string, expect: "pass" | "fail", rule?: string): GateStep {
  return {
    command: ["pnpm", "exec", "commitlint"],
    input: message,
    expect,
    ...(rule === undefined ? {} : { output: [new RegExp(`\\[${rule}\\]`)] }),
  };
}

/** Cases for commitlint on commit messages and PR titles. */
export function commitCases(): readonly GateCase[] {
  return [
    {
      name: "commitlint accepts subjects in the house style",
      files: fixturePackage("core", {}),
      steps: [
        commitlint("build: set up the pnpm workspace, Turborepo and TypeScript 7\n", "pass"),
        commitlint("feat(core): add results and errors with dotted codes\n", "pass"),
        commitlint("build(deps): move vitest to 5.0.2 (#41)\n", "pass"),
        commitlint("revert: feat(core): add results\n\nThis reverts commit 1a2b3c4.\n", "pass"),
        commitlint(
          "feat(docs)!: rename the guide\n\nBreaking: links to the old page stop working.\n",
          "pass",
        ),
      ],
    },
    {
      name: "commitlint refuses a bad scope, type, length or breaking change",
      steps: [
        commitlint("fix(wallet): show the balance\n", "fail", "scope-enum"),
        commitlint("fix(docs,deps): fix two things\n", "fail", "scope-single"),
        commitlint("feature(docs): add a page\n", "fail", "type-enum"),
        commitlint(
          "docs: describe every command the agent offers on every surface it talks to\n",
          "fail",
          "header-length",
        ),
        commitlint("feat(docs)!: rename the guide\n", "fail", "breaking-paragraph"),
        commitlint("docs: Describe the guide\n", "fail", "subject-starts-lowercase"),
        commitlint("revert: feat(core): add results\n", "fail", "revert-reference"),
      ],
    },
    {
      name: "commitlint refuses a feature folder named like a package",
      files: {
        ...fixturePackage("core", {}),
        ...fixturePackage("engine", { "core/rule.ts": "export const rule: number = 1;\n" }),
      },
      steps: [
        {
          command: ["pnpm", "exec", "commitlint"],
          input: "fix(core): keep the order\n",
          expect: "fail",
          output: [/reuses a package name/],
        },
      ],
    },
  ];
}
