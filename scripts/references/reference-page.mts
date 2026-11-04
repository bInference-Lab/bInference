import type { Formatter } from "@binference/i18n";

/** One generated reference page: its words, its file name under `reference/` and how it renders. */
export interface ReferencePage {
  /** The key of its words in the `docs` area: `config`. */
  readonly name: string;
  /** Its file name under `reference/`, without `.md`. */
  readonly file: string;
  /** Its Markdown body in the formatter's language. */
  readonly render: (formatter: Formatter) => string;
}

function tableLine(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
}

/** A Markdown table, each cell's pipes escaped. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [tableLine(headers), tableLine(headers.map(() => "---")), ...rows.map(tableLine)].join(
    "\n",
  );
}

/** Text as inline code. */
export function code(text: string): string {
  return `\`${text}\``;
}

// The full stop of Chinese text, built from its code point so this file holds no Chinese.
const chineseStop = String.fromCodePoint(0x3002);

/** What goes between two sentences: a space in English, nothing in Chinese. */
export function separator(formatter: Formatter): string {
  return formatter.locale === "zh" ? "" : " ";
}

/** Text that ends as a sentence in the formatter's language. */
export function sentence(text: string, formatter: Formatter): string {
  const isEnded = text.endsWith(".") || text.endsWith(chineseStop);
  if (isEnded) {
    return text;
  }
  return `${text}${formatter.locale === "zh" ? chineseStop : "."}`;
}
