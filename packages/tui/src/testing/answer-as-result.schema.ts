import { z } from "zod";

/**
 * A fake engine's answer, taken as the result its caller expects without a check: the test wrote
 * it, with only the fields the chat reads.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the operation called names the result type the answer stands for
export function answerAsResult<T>(answer: unknown): T {
  return z.custom<T>().parse(answer);
}
