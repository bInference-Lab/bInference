import type { IntentRecord } from "../intents/intent-record.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { bookLateLanding } from "./book-late-landing.js";
import { type ExecutionRun, nextBlock } from "./executor-run.js";
import { finalFate, type NonceTransactions, readFate, rivalsOf } from "./step-fate.js";

/** A step the drop rule ended (decision 0115): its intent, and the transaction recorded `dropped`. */
export interface DroppedStep {
  readonly intent: IntentRecord;
  readonly dropped: TransactionRecord;
}

// The owner's alarm when a step the executor dropped lands after all.
const droppedLandedNoticeKey = "notice.droppedLanded";

/** A dropped step under watch: the step, its transactions at its nonce, and when it ends. */
interface Watch {
  readonly step: DroppedStep;
  readonly at: NonceTransactions;
  readonly endsAtMs: number;
}

/**
 * When the watch of a dropped step ends: `finalAfterBlocks` blocks of its chain after its intent
 * ended, by the clock, so a restart resumes it for the time left and an agent's fill line holds
 * as long (decision 0211).
 */
export function droppedWatchEndsAt(
  run: Pick<ExecutionRun, "parts" | "plan">,
  droppedAtMs: number,
): number {
  return droppedAtMs + run.parts.limits.finalAfterBlocks * run.plan.chain.definition.blockTimeMs;
}

async function watchFrom(run: ExecutionRun, watch: Watch): Promise<void> {
  const { step, at, endsAtMs } = watch;
  if (run.parts.clock.now() >= endsAtMs) {
    return;
  }
  const read = await readFate(run, at);
  const fate = read?.kind === "taken" ? await finalFate(run, at) : read;
  if (fate?.kind === "found") {
    const { id, agentId } = step.intent;
    run.parts.log.error("executor.dropped_landed", { intentId: id, chain: run.plan.chain.ref });
    run.parts.publish(
      noticePush({ key: droppedLandedNoticeKey, agent: agentId, intent: id, values: {} }),
    );
    const dropped = await run.parts.stored.snapshot(id, { signal: run.signal });
    if (dropped !== undefined) {
      await bookLateLanding(run, dropped, fate);
    }
    return;
  }
  if (fate?.kind === "taken") {
    return;
  }
  await nextBlock(run);
  await watchFrom(run, watch);
}

/**
 * Watches a dropped step's transactions each block for `finalAfterBlocks` blocks of its chain from
 * the drop, by the clock, off the wallet's queue: a relay or a node the drop rule could not see may still put one in a block. One that
 * lands is logged as `executor.dropped_landed`, raises `notice.droppedLanded`, and is booked as a
 * late landing linked to its intent, which stays `failed_onchain` (decision 0147). The watch ends
 * early once a final block holds the step's nonce without any of them. It signs and sends nothing.
 */
export async function watchDropped(run: ExecutionRun, step: DroppedStep): Promise<void> {
  const stored = await run.parts.stores.transactions.ofIntent(step.intent.id, {
    signal: run.signal,
  });
  const at = { transaction: step.dropped, rivals: rivalsOf(stored, step.dropped) };
  const endsAtMs = droppedWatchEndsAt(run, step.intent.changedAtMs);
  await watchFrom(run, { step, at, endsAtMs });
}
