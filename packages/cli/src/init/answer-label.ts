import { type AnswerName, type AnswerOrigin, answerOfFlag } from "./answer-names.js";
import type { InitContext } from "./init-context.js";

/**
 * How a refusal names an answer: by its flag when a flag gave it or nothing did, or by its
 * variable. Never by its value.
 */
export function answerLabel(answer: AnswerName, origin: AnswerOrigin | undefined): string {
  return origin?.layer === "variable" ? origin.name : answer.flag;
}

/**
 * How a refusal names the answer a flag such as `--rescue` takes: by that flag, or by the
 * `BINFERENCE_INIT_*` variable that gave it (decision 0224).
 */
export function flagLabel(context: Pick<InitContext, "origins">, flag: string): string {
  const answer = answerOfFlag(flag);
  return answer === undefined ? flag : answerLabel(answer, context.origins.get(answer.key));
}
