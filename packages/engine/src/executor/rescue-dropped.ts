import type { Id } from "@binference/core";
import type { ExecutionRun } from "./executor-run.js";
import { recordReceipt } from "./run-step.js";
import type { Watched } from "./send-and-watch.js";
import { readFate } from "./step-fate.js";

/**
 * Whether a rescue step whose transactions were all dropped landed after all (decision 0115),
 * read before the step is signed again: one a block holds is the step's, `included` or
 * `reverted`, with its receipt recorded. `unread` when no node answered, so nothing is signed
 * now; `undefined` when the step has no dropped transaction or none of them landed.
 */
export async function droppedLanded(
  run: ExecutionRun,
  step: { readonly intent: Id<"int">; readonly index: number },
): Promise<Watched | "unread" | undefined> {
  const stored = await run.parts.stores.transactions.ofIntent(step.intent, { signal: run.signal });
  const [last, ...earlier] = stored
    .filter(({ step: index, state }) => index === step.index && state === "dropped")
    .toReversed();
  if (last === undefined) {
    return undefined;
  }
  const fate = await readFate(run, { transaction: last, rivals: earlier });
  if (fate?.kind !== "found") {
    return fate === undefined ? "unread" : undefined;
  }
  const transaction = await recordReceipt(run, fate.transaction, fate.receipt);
  return { outcome: transaction.state === "reverted" ? "reverted" : "included", transaction };
}
