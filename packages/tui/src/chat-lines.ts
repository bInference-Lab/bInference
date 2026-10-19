import {
  cardLineText,
  displayOutsideText,
  type Formatter,
  type MessageValues,
} from "@binference/i18n";
import {
  type CardLinesView,
  protocolErrorCodes,
  questionLimits,
  type QuestionView,
} from "@binference/protocol";
import type { ScreenLine } from "./chat-screen.js";

// The most characters of the agent's name a line shows (spec 4, section 1).
const nameLength = 40;
const knownCodes: ReadonlySet<string> = new Set(protocolErrorCodes);

/** A message of any area by its full key, such as `tui.closed`, in the owner's language. */
export type Words = (key: string, values?: MessageValues) => string;

/** The formatter's messages as {@link Words}. */
export function wordsOf(formatter: Formatter): Words {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return (key, values) => formatter.message(key, values);
}

/** The agent's name as the chat writes it: cut, every character a reader cannot see written out. */
export function agentNameText(name: string): string {
  return displayOutsideText(name, nameLength);
}

/**
 * Text set outside binference, such as the agent's words, as the lines it holds. Every other
 * character a reader cannot see, or that moves the cursor, shows as `\u{…}`, so a model's words
 * never steer the terminal. Longer than `most` characters, it is cut and ends with `…`.
 */
function outsideLines(text: string, most = Number.POSITIVE_INFINITY): readonly string[] {
  const characters = Array.from(text);
  const kept = characters.length > most ? `${characters.slice(0, most - 1).join("")}…` : text;
  return kept.split(/\r?\n/).map((line) => displayOutsideText(line, Number.POSITIVE_INFINITY));
}

/** What the owner or the agent said, under the speaker's name, each further line indented. */
export function saidLines(speaker: string, text: string): readonly ScreenLine[] {
  const [first = "", ...rest] = outsideLines(text);
  return [{ text: `${speaker}: ${first}` }, ...rest.map((line) => ({ text: `  ${line}` }))];
}

/** A turn's status line in the owner's language: a time it names reads in the owner's zone. */
export function statusLine(
  formatter: Formatter,
  statusKey: string,
  values: Readonly<Record<string, string | number>> = {},
): ScreenLine {
  const { when } = values;
  const shown = typeof when === "number" ? { ...values, when: formatter.dateTime(when) } : values;
  return { text: wordsOf(formatter)(statusKey, shown), tone: "dim" };
}

/** The agent's question as the chat prints it: its header, its words and its numbered choices. */
export function questionLines(
  formatter: Formatter,
  question: QuestionView,
  agentName: string,
): readonly ScreenLine[] {
  const words = wordsOf(formatter);
  const choices = question.choices.map((choice, place) => ({
    text: words("tui.question.choice", {
      number: place + 1,
      choice: displayOutsideText(choice, questionLimits.choice),
    }),
  }));
  return [
    { text: words("question.header", { agent: agentName }), tone: "bold" },
    ...outsideLines(question.text, questionLimits.text).map((line) => ({ text: line })),
    ...choices,
  ];
}

/** A card version's lines as the engine draws them, in the owner's language, its header first. */
export function cardLines(formatter: Formatter, card: CardLinesView): readonly ScreenLine[] {
  const display = { formatter, assets: card.assets };
  return card.lines.map((line, at) => ({
    text: cardLineText(line, display),
    ...(at === 0 ? { tone: "yellow" as const } : {}),
  }));
}

function codeOf(error: ErrorOptions["cause"]): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Why a call failed, in the owner's language: the message of its protocol error code, which
 * names the next step; any other fault points to the log.
 */
export function failureText(words: Words, error: ErrorOptions["cause"]): string {
  const code = codeOf(error);
  return code !== undefined && knownCodes.has(code)
    ? words(`error.${code}`)
    : words("tui.otherError");
}
