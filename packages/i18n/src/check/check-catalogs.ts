import type {
  AreaMessages,
  LocaleMessages,
  MessageFiles,
  MessageProblem,
} from "./message-files.js";
import { parseMessage } from "./parse-message.js";

/** One translation beside the source it must match. */
interface Pair {
  readonly locale: string;
  readonly source: LocaleMessages;
  readonly target: LocaleMessages;
}

type AreaEntry = readonly [string, AreaMessages];
type MessageEntry = readonly [string, string];

const missingFile = "The file is missing; add it with every key of the source.";
const extraFile = "The source has no such file; add it there first.";
const missingKey = "The key is missing; translate the source message.";
const extraKey = "The source has no such key; add it there first.";

function areaGaps(pair: Pair): readonly MessageProblem[] {
  const missing = Object.keys(pair.source)
    .filter((area) => pair.target[area] === undefined)
    .map((area): MessageProblem => ({ locale: pair.locale, area, text: missingFile }));
  const extra = Object.keys(pair.target)
    .filter((area) => pair.source[area] === undefined)
    .map((area): MessageProblem => ({ locale: pair.locale, area, text: extraFile }));
  return [...missing, ...extra];
}

function keyGaps(pair: Pair): readonly MessageProblem[] {
  return Object.entries(pair.source).flatMap(([area, sourceArea]: AreaEntry) => {
    const targetArea = pair.target[area];
    if (targetArea === undefined) {
      return [];
    }
    const missing = Object.keys(sourceArea)
      .filter((key) => targetArea[key] === undefined)
      .map((key): MessageProblem => ({ locale: pair.locale, area, key, text: missingKey }));
    const extra = Object.keys(targetArea)
      .filter((key) => sourceArea[key] === undefined)
      .map((key): MessageProblem => ({ locale: pair.locale, area, key, text: extraKey }));
    return missing.concat(extra);
  });
}

function listed(names: readonly string[]): string {
  return names.length === 0 ? "no arguments" : names.join(" ");
}

function argumentGap(source: string, target: string): string | undefined {
  const sourceParsed = parseMessage(source);
  const targetParsed = parseMessage(target);
  if (!sourceParsed.ok || !targetParsed.ok) {
    return undefined;
  }
  const wanted = listed(sourceParsed.value.arguments);
  const found = listed(targetParsed.value.arguments);
  return wanted === found
    ? undefined
    : `The arguments are ${found}, but the source has ${wanted}; use the same.`;
}

function argumentGaps(pair: Pair): readonly MessageProblem[] {
  return Object.entries(pair.source).flatMap(([area, sourceArea]: AreaEntry) =>
    Object.entries(sourceArea).flatMap(([key, source]: MessageEntry): MessageProblem[] => {
      const target = pair.target[area]?.[key];
      const text = target === undefined ? undefined : argumentGap(source, target);
      return text === undefined ? [] : [{ locale: pair.locale, area, key, text }];
    }),
  );
}

function parseFailures(locale: string, messages: LocaleMessages): readonly MessageProblem[] {
  return Object.entries(messages).flatMap(([area, entries]: AreaEntry) =>
    Object.entries(entries).flatMap(([key, text]: MessageEntry): MessageProblem[] => {
      const parsed = parseMessage(text);
      return parsed.ok
        ? []
        : [{ locale, area, key, text: `The ICU message does not parse: ${parsed.error}.` }];
    }),
  );
}

/**
 * Checks that every language has the source language's files and keys, no more, that every
 * message parses as ICU, and that each translation has the source's arguments.
 */
export function checkCatalogs(
  files: MessageFiles,
  sourceLocale: string,
): readonly MessageProblem[] {
  const source = files[sourceLocale];
  if (source === undefined) {
    return [{ locale: sourceLocale, area: "*", text: "The source language has no messages." }];
  }
  const locales = Object.keys(files);
  const pairs = locales
    .filter((locale) => locale !== sourceLocale)
    .map((locale): Pair => ({ locale, source, target: files[locale] ?? {} }));
  return [
    ...locales.flatMap((locale) => parseFailures(locale, files[locale] ?? {})),
    ...pairs.flatMap((pair) => areaGaps(pair)),
    ...pairs.flatMap((pair) => keyGaps(pair)),
    ...pairs.flatMap((pair) => argumentGaps(pair)),
  ];
}
