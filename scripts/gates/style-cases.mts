import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase } from "./gate-case.mjs";

// Seeds are built at run time, so this file holds none of the text check:style refuses.
function seeds(repo: string): Readonly<Record<string, string>> {
  const words = readFileSync(join(repo, "config/style/banned-words.txt"), "utf8").split("\n");
  const tools = readFileSync(join(repo, "config/style/ai-tools.txt"), "utf8").split("\n");
  const tool = tools[0] ?? "";
  return {
    dash: `Fast ${String.fromCodePoint(0x2014)} and safe.`,
    banned: `It is ${words[0] ?? ""} to use.`,
    planId: `See ${["P1", "03"].join("-")} for the details.`,
    trailer: `${["Co", "authored", "by"].join("-")}: ${tool.toUpperCase()} <noreply@example.com>`,
    chinese: `Hello ${String.fromCodePoint(0x4e2d, 0x6587)}.`,
  };
}

function styleCase(name: string, text: string, rule: string): GateCase {
  return {
    name,
    files: { "notes.md": `# Notes\n\n${text}\n` },
    steps: [
      {
        command: ["pnpm", "check:style"],
        expect: "fail",
        output: [new RegExp(`notes\\.md:3: check:style\\(${rule}\\)`)],
      },
    ],
  };
}

function messageCase(name: string, message: string, rule: string): GateCase {
  return {
    name,
    files: { ".gates/message.txt": message },
    steps: [
      {
        command: ["pnpm", "check:style", "--message-file", ".gates/message.txt"],
        expect: "fail",
        output: [new RegExp(`check:style\\(${rule}\\)`)],
      },
    ],
  };
}

// The glossary may hold Chinese (config/style/rule-exceptions.txt), and nothing else it would
// otherwise fail.
function exceptionCases(seed: Readonly<Record<string, string>>): readonly GateCase[] {
  return [
    {
      name: "Chinese passes check:style in a file listed for cjk",
      files: { "docs/GLOSSARY.md": `# Glossary\n\n${seed["chinese"] ?? ""}\n` },
      steps: [{ command: ["pnpm", "check:style"], expect: "pass" }],
    },
    {
      name: "an emoji fails check:style in a file listed only for cjk",
      files: { "docs/GLOSSARY.md": `# Glossary\n\nDone ${String.fromCodePoint(0x2705)}\n` },
      steps: [
        {
          command: ["pnpm", "check:style"],
          expect: "fail",
          output: [/docs\/GLOSSARY\.md:3: check:style\(emoji\)/],
        },
      ],
    },
  ];
}

/** Cases for check:style on files and on commit messages. */
export function styleCases(repo: string): readonly GateCase[] {
  const seed = seeds(repo);
  const testHash = createHash("sha256").update("zebrafish").digest("hex");
  return [
    styleCase("an em dash fails check:style", seed["dash"] ?? "", "dash"),
    styleCase("a banned word fails check:style", seed["banned"] ?? "", "banned-word"),
    styleCase("a plan id fails check:style", seed["planId"] ?? "", "plan-id"),
    styleCase("Chinese outside a zh file fails check:style", seed["chinese"] ?? "", "cjk"),
    {
      name: "a reserved name fails check:style through its hash",
      files: {
        "config/style/reserved.sha256": `${testHash}\n`,
        "notes.md": "# Notes\n\nA zebrafish swims.\n",
      },
      steps: [
        {
          command: ["pnpm", "check:style"],
          expect: "fail",
          output: [/notes\.md:3: check:style\(reserved-name\)/],
        },
      ],
    },
    ...exceptionCases(seed),
    messageCase(
      "an AI trailer fails check:style on a commit message",
      `build: add a gate\n\n${seed["trailer"] ?? ""}\n`,
      "ai-trailer",
    ),
    messageCase(
      "a vague word and an issue number fail check:style on a commit message",
      "fix: improve the gate for #12\n",
      "vague-word",
    ),
    messageCase(
      "a heading and a checklist in a commit body fail check:style",
      "build: add a gate\n\n## Why\n\n- [ ] tested\n",
      "body-checkbox",
    ),
  ];
}
