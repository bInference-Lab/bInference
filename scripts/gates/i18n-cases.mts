import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { failingCase, type GateCase } from "./gate-case.mjs";

const reasonFile = (locale: string): string => `packages/i18n/messages/${locale}/reason.json`;
const codesFile = "packages/protocol/src/errors/protocol-error-codes.ts";
const areaSchema = z.record(z.string(), z.string());
const plantedKey = "planted_case";

// Chinese is built from code points, so this file holds no Chinese text itself: "exceeds", the
// glossary's word for swap, and another word for it.
const exceeds = String.fromCodePoint(0x8d85, 0x8fc7);
const glossarySwap = String.fromCodePoint(0x5151, 0x6362);
const otherSwap = String.fromCodePoint(0x4ea4, 0x6362);

// Adds one key to the real reason files, so the cases follow the files as they grow.
function withReason(repo: string, texts: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(texts).map(([locale, text]) => {
      const current = areaSchema.parse(
        JSON.parse(readFileSync(join(repo, reasonFile(locale)), "utf8")),
      );
      const next = { ...current, [plantedKey]: text };
      return [reasonFile(locale), `${JSON.stringify(next, null, 2)}\n`];
    }),
  );
}

// Adds a code to the protocol's list. When the list moves on, this throws instead of planting
// nothing and letting the case pass.
function withProtocolCode(repo: string, code: string): Record<string, string> {
  const text = readFileSync(join(repo, codesFile), "utf8");
  const end = "] as const;";
  if (!text.includes(end)) {
    throw new Error(`${codesFile} no longer holds ${JSON.stringify(end)}.`);
  }
  return { [codesFile]: text.replace(end, `  ${JSON.stringify(code)},\n${end}`) };
}

const where = (locale: string): string =>
  `packages/i18n/messages/${locale}/reason\\.json "${plantedKey}"`;

/** Cases for check:i18n: keys, arguments, glossary terms and protocol error codes. */
export function i18nCases(repo: string): readonly GateCase[] {
  return [
    failingCase(
      "a key missing in Chinese fails check:i18n",
      withReason(repo, { en: "a planted reason" }),
      ["check:i18n", new RegExp(`${where("zh")}: The key is missing`)],
    ),
    failingCase(
      "an argument renamed in one language fails check:i18n",
      withReason(repo, { en: "over {cap}", zh: `${exceeds} {limit}` }),
      ["check:i18n", new RegExp(`${where("zh")}: The arguments are \\{limit\\}, but the source`)],
    ),
    failingCase(
      "a glossary term translated another way fails check:i18n",
      withReason(repo, { en: "swap {amount}", zh: `${otherSwap} {amount}` }),
      ["check:i18n", new RegExp(`${where("zh")}: The English uses "swap"`)],
    ),
    failingCase(
      "a protocol error code without a message fails check:i18n",
      withProtocolCode(repo, "planted.code"),
      ["check:i18n", /messages\/en\/error\.json "planted\.code": The code has no message/],
    ),
    {
      name: "a new message in both languages with the glossary's words passes check:i18n",
      files: withReason(repo, { en: "swap {amount}", zh: `${glossarySwap} {amount}` }),
      steps: [{ command: ["pnpm", "check:i18n"], expect: "pass" }],
    },
  ];
}
