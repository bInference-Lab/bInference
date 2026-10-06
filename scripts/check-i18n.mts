import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { messageLocales, messages } from "@binference/i18n";
import {
  checkCatalogs,
  checkCodeMessages,
  checkGlossary,
  parseGlossary,
  type LocaleMessages,
  type MessageFiles,
  type MessageProblem,
} from "@binference/i18n/check";
import { localeSchema, protocolErrorCodes } from "@binference/protocol";
import { z } from "zod";

const root = process.cwd();
const messagesFolder = "packages/i18n/messages";
const catalogFile = "packages/i18n/src/messages.ts";
const glossaryFile = "docs/GLOSSARY.md";
const sourceLocale = "en";
const areaSchema = z.record(z.string(), z.string());
const enumSchema = z.object({ enum: z.array(z.string()) });

function folderNames(folder: string): readonly string[] {
  return readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function areaNames(locale: string): readonly string[] {
  return readdirSync(join(root, messagesFolder, locale))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .toSorted();
}

function where(locale: string, area: string): string {
  return `${messagesFolder}/${locale}/${area}.json`;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Reads every area file; a file that is not an object of strings is a problem, not a crash.
function readFiles(problems: string[]): MessageFiles {
  const files: Record<string, LocaleMessages> = {};
  for (const locale of folderNames(messagesFolder)) {
    const areas: Record<string, Readonly<Record<string, string>>> = {};
    for (const area of areaNames(locale)) {
      const text = readFileSync(join(root, where(locale, area)), "utf8");
      const parsed = areaSchema.safeParse(parsedJson(text));
      if (parsed.success) {
        areas[area] = parsed.data;
      } else {
        problems.push(`${where(locale, area)}: must be one JSON object of keys to message texts.`);
      }
    }
    files[locale] = areas;
  }
  return files;
}

// The protocol owns the language list; the message folders and the i18n package follow it.
function localeProblems(files: MessageFiles): readonly string[] {
  const wanted = enumSchema.parse(z.toJSONSchema(localeSchema)).enum.toSorted().join(", ");
  const folders = Object.keys(files).toSorted().join(", ");
  const loaded = messageLocales.toSorted().join(", ");
  return [
    ...(folders === wanted
      ? []
      : [`${messagesFolder}: holds ${folders}, but the protocol's locales are ${wanted}.`]),
    ...(loaded === wanted
      ? []
      : [`packages/i18n/src/locales.ts: lists ${loaded}, but the protocol's are ${wanted}.`]),
  ];
}

// The package imports each area file by name; a file it does not import is never shown.
function loadProblems(files: MessageFiles): readonly string[] {
  const loaded: Readonly<Record<string, Readonly<Record<string, string>>>> = messages;
  return Object.entries(files).flatMap(([locale, areas]) =>
    Object.entries(areas)
      .filter(([area, entries]) =>
        Object.keys(entries).some((key) => loaded[locale]?.[`${area}.${key}`] === undefined),
      )
      .map(([area]) => `${where(locale, area)}: is not imported in ${catalogFile}; add it there.`),
  );
}

function printed(problem: MessageProblem): string {
  const key = problem.key === undefined ? "" : ` "${problem.key}"`;
  return `${where(problem.locale, problem.area)}${key}: ${problem.text}`;
}

function run(): number {
  const problems: string[] = [];
  const files = readFiles(problems);
  const glossaryText = readFileSync(join(root, glossaryFile), "utf8");
  const terms = parseGlossary(glossaryText);
  if (terms.length === 0) {
    problems.push(`${glossaryFile}: has no term tables under "## Chinese terms".`);
  }
  const found = [
    ...checkCatalogs(files, sourceLocale),
    ...checkCodeMessages({
      locale: sourceLocale,
      area: "error",
      messages: files[sourceLocale] ?? {},
      codes: protocolErrorCodes,
    }),
    ...checkGlossary(files, terms),
  ];
  problems.push(...localeProblems(files), ...loadProblems(files), ...found.map(printed));
  for (const problem of problems) {
    console.error(`check:i18n: ${problem}`);
  }
  if (problems.length === 0) {
    const count = Object.values(files[sourceLocale] ?? {}).flatMap(Object.keys).length;
    console.log(`check:i18n: ${String(count)} messages match in every language and the glossary.`);
  }
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = run();
