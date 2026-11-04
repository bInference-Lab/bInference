import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GateCase } from "./gate-case.mjs";
import { planted } from "./planted.mjs";

const schemaFile = "packages/cli/src/config/schema/engine.schema.ts";
const englishConfig = "apps/docs/src/content/docs/reference/config.md";
const chineseConfig = "apps/docs/src/content/docs/zh-cn/reference/config.md";
const chineseKeys = "packages/i18n/messages/zh/configKeys.json";
const englishDocs = "packages/i18n/messages/en/docs.json";

const check = ["pnpm", "check:references"];
const generate = ["pnpm", "docs:gen"];

// A message catalog with one message left out, so a gate case never edits a catalog by hand.
function withoutMessage(repo: string, file: string, key: string): Record<string, string> {
  const catalog = z
    .record(z.string(), z.string())
    .parse(JSON.parse(readFileSync(join(repo, file), "utf8")));
  if (catalog[key] === undefined) {
    throw new Error(`${file} no longer holds ${key}.`);
  }
  const rest = Object.fromEntries(Object.entries(catalog).filter(([name]) => name !== key));
  return { [file]: `${JSON.stringify(rest, null, 2)}\n` };
}

function behindCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "a config default changed without docs:gen fails check:references",
      cost: 3,
      files: planted(repo, schemaFile, [
        ["portSchema.prefault(7456)", "portSchema.prefault(7458)"],
      ]),
      steps: [
        {
          command: check,
          expect: "fail",
          output: [/reference\/config\.md: check:references: the file is behind the code/],
        },
        { command: generate, expect: "pass" },
        { command: check, expect: "pass" },
      ],
    },
    {
      name: "a hand edit to a generated reference page fails check:references",
      cost: 2,
      files: planted(repo, chineseConfig, [["`7456`", "`7458`"]]),
      steps: [
        {
          command: check,
          expect: "fail",
          output: [/zh-cn\/reference\/config\.md: check:references: the file is behind the code/],
        },
      ],
    },
    {
      name: "a page no code generates in a reference folder fails check:references",
      cost: 2,
      files: { [englishConfig.replace("config.md", "notes.md")]: "---\ntitle: Notes\n---\n" },
      steps: [
        {
          command: check,
          expect: "fail",
          output: [/reference\/notes\.md: check:references: no code generates this file/],
        },
      ],
    },
  ];
}

function missingCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "a config key without its Chinese text fails check:references and docs:gen",
      cost: 2,
      files: withoutMessage(repo, chineseKeys, "engine.port"),
      steps: [
        {
          command: check,
          expect: "fail",
          output: [/zh\/configKeys\.json: check:references: "engine\.port" has no Chinese text/],
        },
        {
          command: generate,
          expect: "fail",
          output: [/texts without their English or Chinese message: 1/],
        },
      ],
    },
    {
      name: "a tool without its summary fails check:references",
      cost: 2,
      files: withoutMessage(repo, englishDocs, "tools.summary.quote"),
      steps: [
        {
          command: check,
          expect: "fail",
          output: [/en\/docs\.json: check:references: "tools\.summary\.quote" is missing/],
        },
      ],
    },
  ];
}

/**
 * Cases for check:references: the docs site's reference pages say what the code says, and every
 * text they show has its English and Chinese message.
 */
export function referenceCases(repo: string): readonly GateCase[] {
  return [...behindCases(repo), ...missingCases(repo)];
}
