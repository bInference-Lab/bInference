import { createFormatter, type Formatter, type MessageLocale } from "@binference/i18n";
import { commandsPage } from "./commands-page.mjs";
import { configPage } from "./config-page.mjs";
import { noticesPage } from "./notices-page.mjs";
import { operationsPage } from "./operations-page.mjs";
import type { ReferencePage } from "./reference-page.mjs";
import { toolsPage } from "./tools-page.mjs";

/** The folders that hold only generated reference pages: English, then Chinese. */
export const referenceFolders: Readonly<Record<MessageLocale, string>> = {
  en: "apps/docs/src/content/docs/reference/",
  zh: "apps/docs/src/content/docs/zh-cn/reference/",
};

const pages: readonly ReferencePage[] = [
  commandsPage,
  configPage,
  noticesPage,
  operationsPage,
  toolsPage,
];

/** One generated file: where it goes and its text. */
export interface ReferenceFile {
  readonly file: string;
  readonly text: string;
}

function frontMatter(page: ReferencePage, formatter: Formatter): string {
  const words = (key: string): string =>
    JSON.stringify(formatter.message(`docs.${page.name}.${key}`));
  return ["---", `title: ${words("title")}`, `description: ${words("description")}`, "---"].join(
    "\n",
  );
}

const header =
  "<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->";

function fileOf(page: ReferencePage, locale: MessageLocale): ReferenceFile {
  // Times on the pages are the notice table's, read in UTC on every machine.
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  const body = page.render(formatter);
  const text = [frontMatter(page, formatter), "", header, "", body.trimEnd(), ""].join("\n");
  return { file: `${referenceFolders[locale]}${page.file}.md`, text };
}

/**
 * Every generated reference page, in English and Chinese, as the code says it now. It throws on a
 * message a page needs that a catalog lacks, so `missingMessages` runs first.
 */
export function referencePages(): readonly ReferenceFile[] {
  return (["en", "zh"] as const).flatMap((locale) => pages.map((page) => fileOf(page, locale)));
}
