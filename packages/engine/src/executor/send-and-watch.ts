import type { ChainHead, TxReceipt } from "@binference/chain";
import type { IntentRecord } from "../intents/intent-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, nextBlock, readSafely } from "./executor-run.js";
import { recordReceipt, sendOnce } from "./run-step.js";
import { landedOf, type NonceTransactions } from "./step-fate.js";

/**
 * How the watch of a sent step ended: a block holds one of its transactions (`included`,
 * `reverted`, or `cancelled` when that one is its cancel), or it is `stuck` and handed over.
 */
export type Watched =
  | {
      readonly outcome: "included" | "reverted" | "cancelled";
      readonly transaction: TransactionRecord;
    }
  | {
      readonly outcome: "stuck";
      readonly transaction: TransactionRecord;
      readonly problem: string;
    };

/** Where the watch of one step stands. */
interface WatchState extends NonceTransactions {
  readonly intent: IntentRecord;
  /** Sends of the current transaction's bytes. */
  readonly sends: number;
  /** Blocks waited since the head was last read. */
  readonly waits: number;
  /** The latest block when the watch of the current transaction first read the head. */
  readonly firstBlock?: bigint;
}

// While no relay has accepted the stored bytes, each wait sends them again, up to the limit.
async function sendIfUnsent(run: ExecutionRun, state: WatchState): Promise<WatchState> {
  if (state.transaction.state !== "signed" || state.sends >= run.parts.limits.sendAttempts) {
    return state;
  }
  const transaction = await sendOnce(run, state.intent, state.transaction);
  return { ...state, transaction, sends: state.sends + 1 };
}

async function settle(
  run: ExecutionRun,
  landed: { readonly transaction: TransactionRecord; readonly receipt: TxReceipt },
): Promise<Watched> {
  const transaction = await recordReceipt(run, landed.transaction, landed.receipt);
  if (transaction.replaces?.kind === "cancel") {
    return { outcome: "cancelled", transaction };
  }
  return { outcome: landed.receipt.status === "success" ? "included" : "reverted", transaction };
}

// Stuck once the head moved the limit past where the watch began.
function isStuck(run: ExecutionRun, state: WatchState, head: ChainHead | undefined): boolean {
  const { firstBlock } = state;
  return (
    head !== undefined &&
    firstBlock !== undefined &&
    head.latest - firstBlock >= BigInt(run.parts.limits.stuckAfterBlocks)
  );
}

// One block's look: a receipt of any of the step's transactions ends the watch.
async function lookOnce(run: ExecutionRun, before: WatchState): Promise<WatchState | Watched> {
  const { plan, signal } = run;
  const state = await sendIfUnsent(run, before);
  const landed = await readSafely(run, async () => landedOf(run, state));
  if (landed !== undefined) {
    return settle(run, landed);
  }
  const head = await readSafely(run, async () =>
    plan.sending.receipts.head(plan.chain.ref, { signal }),
  );
  const firstBlock = state.firstBlock ?? head?.latest;
  const seen =
    head === undefined || firstBlock === undefined ? state : { ...state, firstBlock, waits: 0 };
  return isStuck(run, seen, head)
    ? { outcome: "stuck", transaction: seen.transaction, problem: "stuck" }
    : seen;
}

async function watchFrom(run: ExecutionRun, before: WatchState): Promise<Watched> {
  if (before.waits >= run.parts.limits.stuckAfterBlocks * 3) {
    return { outcome: "stuck", transaction: before.transaction, problem: "stuck" };
  }
  const looked = await lookOnce(run, before);
  if ("outcome" in looked) {
    return looked;
  }
  await nextBlock(run);
  return watchFrom(run, { ...looked, waits: looked.waits + 1 });
}

/**
 * Sends a stored step and watches each block until a block holds one of its transactions at its
 * nonce: the stored one, or one it replaced (`rivals`), whichever lands. While no relay has
 * accepted the current bytes, every block sends them again, up to the send limit; nothing is ever
 * signed again. A step with no transaction in a block `stuckAfterBlocks` blocks after the watch
 * began, or one whose watch cannot read the head for three times as many blocks in a row, is
 * `stuck` and handed over.
 */
export async function sendAndWatch(
  run: ExecutionRun,
  step: NonceTransactions & { readonly intent: IntentRecord },
): Promise<Watched> {
  const { intent, transaction, rivals } = step;
  return watchFrom(run, { intent, transaction, rivals, sends: 0, waits: 0 });
}
