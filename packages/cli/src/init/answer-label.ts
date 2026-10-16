import type { MessageValues } from "@binference/i18n";
import { type AnswerName, type AnswerOrigin, answerOfFlag } from "./answer-names.js";
import type { InitContext } from "./init-context.js";

/** A message of the `init` area in the owner's language. */
export type AnswerWords = (key: string, values?: MessageValues) => string;

/**
 * How a refusal names an answer: by its flag when a flag gave it or nothing did, by its variable,
 * or by its key in the answers file. Never by its value.
 */
export function answerLabel(
  words: AnswerWords,
  answer: AnswerName,
  origin: AnswerOrigin | undefined,
): string {
  if (origin?.layer === "file") {
    return words("answers.inFile", { key: answer.key, file: origin.file });
  }
  return origin?.layer === "variable" ? origin.name : answer.flag;
}

/**
 * How a refusal names the answer a flag such as `--rescue` takes: by that flag, or by the
 * `BINFERENCE_INIT_*` variable or the answers file's key that gave it (decision 0224).
 */
export function flagLabel(context: Pick<InitContext, "words" | "origins">, flag: string): string {
  const answer = answerOfFlag(flag);
  return answer === undefined
    ? flag
    : answerLabel(context.words, answer, context.origins.get(answer.key));
}
