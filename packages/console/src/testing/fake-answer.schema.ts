import * as z from "zod/mini";

/**
 * A fake engine's answer, taken as the result its caller expects without a check: the test wrote
 * it, often with only the fields the screen under test reads.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller's operation names the result type the answer stands for
export function fakeAnswerOf<T>(answer: unknown): T {
  return z.custom<T>().parse(answer);
}
