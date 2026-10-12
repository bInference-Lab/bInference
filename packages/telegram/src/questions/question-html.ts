import { displayOutsideText } from "@binference/i18n";
import type { QuestionView } from "@binference/protocol";
import { escapeHtml } from "../format/escape-html.js";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { questionCallbackData } from "./question-callback.schema.js";

/** The words of a question's message, in the owner's language. */
export type QuestionWords = (key: string, values?: Readonly<Record<string, string>>) => string;

// The agent writes the question and its choices: each shows as text, never as markup.
const questionCharacters = 500;
const choiceCharacters = 64;
// Two buttons share a row when both labels are this short (spec 4, section 8.2).
const pairedLabel = 20;

function shown(text: string, most: number): string {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => displayOutsideText(line, most))
    .join("\n")
    .trim();
}

/** A choice as its button and its answer line show it. */
function choiceLabel(choice: string): string {
  return shown(choice, choiceCharacters).replaceAll("\n", " ");
}

// The line under the question: the hint while it is open, then how it ended.
function lastLine(question: QuestionView, words: QuestionWords, agent: string): string {
  const { state, answer, closeReason } = question;
  if (state === "open") {
    return words("question.typeHint");
  }
  if (state === "answered" && answer?.choice !== undefined) {
    return words("question.answered", {
      choice: choiceLabel(question.choices[answer.choice] ?? ""),
    });
  }
  if (state === "answered") {
    return words("question.answeredTyped");
  }
  return words("question.closed", { reason: closeReason ?? "expired", agent });
}

/**
 * A question as Telegram HTML (spec 4, section 8.2): the header naming the agent, the agent's
 * words escaped and cut to 500 characters, and the hint that a written answer works too; once it
 * closed, the hint becomes how it ended.
 */
export function questionHtml(question: QuestionView, words: QuestionWords, agent: string): string {
  const header = `<b>${escapeHtml(words("question.header", { agent }))}</b>`;
  const text = escapeHtml(shown(question.text, questionCharacters));
  return [header, text, `<i>${escapeHtml(lastLine(question, words, agent))}</i>`].join("\n");
}

/**
 * The buttons of an open question, one per choice, carrying `bnf1:q:<choice>:<ref>`: two on a row
 * when both labels are 20 characters or less, else one.
 */
export function questionButtons(choices: readonly string[], ref: string): ButtonRows {
  const buttons = choices.map((choice, place) => ({
    text: choiceLabel(choice),
    data: questionCallbackData({ choice: place, ref }),
  }));
  const rows: (typeof buttons)[] = [];
  for (const button of buttons) {
    const last = rows.at(-1);
    const [only] = last ?? [];
    const pairs =
      last?.length === 1 &&
      only !== undefined &&
      Array.from(only.text).length <= pairedLabel &&
      Array.from(button.text).length <= pairedLabel;
    if (pairs) {
      last.push(button);
    } else {
      rows.push([button]);
    }
  }
  return rows;
}
