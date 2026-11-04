import { messages } from "@binference/i18n";
import { operationTools } from "@binference/mcp";
import { describeAgentTools } from "@binference/runtime";
import { configKeyTexts } from "binference";

/** A message a reference page needs that a catalog lacks, and the line that says so. */
export interface MissingMessage {
  readonly key: string;
  readonly problem: string;
}

const catalog = (locale: "en" | "zh", area: string): string =>
  `packages/i18n/messages/${locale}/${area}.json`;

/** The `docs` message of a tool's one-line summary for the owner: `docs.tools.summary.quote`. */
export function toolSummaryKey(tool: string): string {
  return `docs.tools.summary.${tool}`;
}

// The English config key texts are the schema's own, which pnpm docs:gen writes; the Chinese ones
// are written by hand.
function missingConfigKeys(): readonly MissingMessage[] {
  return [...configKeyTexts().keys()]
    .filter((key) => messages.zh[key] === undefined)
    .map((key) => ({
      key,
      problem:
        `${catalog("zh", "configKeys")}: check:references: "${key.slice("configKeys.".length)}" ` +
        "has no Chinese text. Write it there in the glossary's words.",
    }));
}

function missingSummaries(): readonly MissingMessage[] {
  const tools = [
    ...describeAgentTools().map((tool) => tool.name),
    ...operationTools().map((tool) => tool.name),
  ];
  return (["en", "zh"] as const).flatMap((locale) =>
    tools
      .map(toolSummaryKey)
      .filter((key) => messages[locale][key] === undefined)
      .map((key) => ({
        key,
        problem:
          `${catalog(locale, "docs")}: check:references: "${key.slice("docs.".length)}" is ` +
          "missing. Write the tool's one-line summary for the owner in English and Chinese.",
      })),
  );
}

/**
 * The messages the reference pages need that a catalog lacks: a config key's Chinese text, or a
 * tool's summary in either language. A page renders only once none is missing.
 */
export function missingMessages(): readonly MissingMessage[] {
  return [...missingConfigKeys(), ...missingSummaries()];
}
