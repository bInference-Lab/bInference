import type { ChainHead, TxReceipt } from "@binference/chain";
import type { IntentRecord } from "../intents/intent-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, nextBlock, readSafely } from "./executor-run.js";
import { recordReceipt, sendOnce } from "./run-step.js";
import { landedOf, type NonceTransactions } from "./step-fate.js";

/**
 * How the watch of a sent step ended: a block holds one of its transactions (`included`,
 * `reverted`, or `cancelled` when that one is its cancel), or it is `stuck` and handed over with
 * the reason no stuck rule could move it.
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

/** A stuck step at a rule of spec 6, section 6: its transactions, and the rule now due. */
export interface StuckAt extends NonceTransactions {
  readonly intent: IntentRecord;
  /** `resend` once `stuckAfterBlocks` passed with no block, `replace` once `replaceAfterBlocks`. */
  readonly rule: "resend" | "replace";
}

/** What a stuck rule did: nothing yet, found the step in a block, sent it again, or replaced it. */
export type StuckMove =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "landed";
      readonly transaction: TransactionRecord;
      readonly receipt: TxReceipt;
    }
  | { readonly kind: "resent" | "replaced"; readonly transaction: TransactionRecord }
  | { readonly kind: "stopped"; readonly problem: string };

/** Moves a stuck step on by spec 6, section 6; recovery, which never signs, has none. */
export type StuckRules = (at: StuckAt) => Promise<StuckMove>;

/** Where the watch of one step stands. */
interface WatchState extends NonceTransactions {
  readonly intent: IntentRecord;
  /** Sends of the current transaction's bytes. */
  readonly sends: number;
  /** Blocks waited since the head was last read. */
  readonly waits: number;
  /** The latest block when the watch of the current transaction first read the head. */
  readonly firstBlock?: bigint;
  /** The rule to send the same bytes again ran for the current transaction. */
  readonly isResent: boolean;
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

// The rule a stuck step is due for, once the head moved its limit past where the watch began.
function dueRule(
  run: ExecutionRun,
  state: WatchState,
  head: ChainHead | undefined,
): StuckAt["rule"] | undefined {
  const { stuckAfterBlocks, replaceAfterBlocks } = run.parts.limits;
  const { firstBlock } = state;
  if (head === undefined || firstBlock === undefined) {
    return undefined;
  }
  const blocks = head.latest - firstBlock;
  if (blocks >= BigInt(replaceAfterBlocks)) {
    return "replace";
  }
  return blocks >= BigInt(stuckAfterBlocks) && !state.isResent ? "resend" : undefined;
}

// A rule's move becomes the watch's next state, or ends the watch.
async function afterMove(
  run: ExecutionRun,
  state: WatchState,
  move: StuckMove,
): Promise<WatchState | Watched> {
  if (move.kind === "landed") {
    return settle(run, move);
  }
  if (move.kind === "stopped") {
    return { outcome: "stuck", transaction: state.transaction, problem: move.problem };
  }
  if (move.kind === "resent") {
    return { ...state, transaction: move.transaction, isResent: true };
  }
  if (move.kind === "waiting") {
    return state;
  }
  const { firstBlock: _firstBlock, ...rest } = state;
  const rivals = [...state.rivals, state.transaction];
  return { ...rest, transaction: move.transaction, rivals, sends: 1, isResent: false };
}

// One block's look: a receipt of any of the step's transactions ends the watch; a due rule runs.
async function lookOnce(
  run: ExecutionRun,
  rules: StuckRules | undefined,
  before: WatchState,
): Promise<WatchState | Watched> {
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
  const rule = dueRule(run, seen, head);
  if (rule === undefined) {
    return seen;
  }
  if (rules === undefined) {
    return { outcome: "stuck", transaction: seen.transaction, problem: "stuck" };
  }
  return afterMove(run, seen, await rules({ ...seen, rule }));
}

async function watchFrom(
  run: ExecutionRun,
  rules: StuckRules | undefined,
  before: WatchState,
): Promise<Watched> {
  if (before.waits >= run.parts.limits.stuckAfterBlocks * 3) {
    return { outcome: "stuck", transaction: before.transaction, problem: "stuck" };
  }
  const looked = await lookOnce(run, rules, before);
  if ("outcome" in looked) {
    return looked;
  }
  await nextBlock(run);
  return watchFrom(run, rules, { ...looked, waits: looked.waits + 1 });
}

/**
 * Sends a stored step and watches each block until a block holds one of its transactions at its
 * nonce: the stored one, or one it replaced (`rivals`), whichever lands. While no relay has
 * accepted the current bytes, every block sends them again, up to the send limit. Once the step
 * is stuck, `rules` move it on (spec 6, section 6); without them, as in recovery, nothing is
 * signed again and the step is `stuck` `stuckAfterBlocks` blocks after the watch began. A watch
 * that cannot read the head for three times as many blocks in a row hands the step over as
 * `stuck`.
 */
export async function sendAndWatch(
  run: ExecutionRun,
  step: NonceTransactions & { readonly intent: IntentRecord; readonly rules?: StuckRules },
): Promise<Watched> {
  const { intent, transaction, rivals, rules } = step;
  const state = { intent, transaction, rivals, sends: 0, waits: 0, isResent: false };
  return watchFrom(run, rules, state);
}
