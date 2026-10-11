import { accountRefParts, type TxReceipt } from "@binference/chain";
import type { IntentRecord } from "../intents/intent-record.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { dropStep } from "./drop-step.js";
import { type ExecutionRun, nextBlock, readSafely } from "./executor-run.js";
import { recordReceipt, type SendOutcome, sendOnce } from "./run-step.js";
import { landedOf, type NonceTransactions } from "./step-fate.js";

/**
 * How the watch of a sent step ended: a block holds one of its transactions (`included`,
 * `reverted`, or `cancelled` when that one is its cancel), every relay refused it until it was
 * `dropped` (decision 0115), or it is `stuck` and handed over with the reason no stuck rule could
 * move it.
 */
export type Watched =
  | {
      readonly outcome: "included" | "reverted" | "cancelled" | "dropped";
      readonly transaction: TransactionRecord;
    }
  | {
      readonly outcome: "stuck";
      readonly transaction: TransactionRecord;
      readonly problem: string;
    };

// The owner's notice that a wallet's later trades wait behind a step no rule can move.
const heldNoticeKey = "notice.walletHeld";

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
  | ({ readonly kind: "resent" | "replaced" } & SendOutcome)
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
  /** The last send of the step's bytes was refused by every relay, and none was taken since. */
  readonly isRefused: boolean;
  /** The head when the watch first saw every relay refuse the step's bytes, refused since. */
  readonly refusedSince?: bigint;
  /** Set once no rule can move the step: why, and the head when the watch began to wait. */
  readonly handedOver?: { readonly problem: string; readonly atBlock: bigint };
  /** The head at the last send of the same bytes while the step waits handed over. */
  readonly lastSendBlock?: bigint;
  /** The handed-over wait ran out and the owner heard that the wallet waits behind the step. */
  readonly isHeld?: boolean;
}

// A send's answers: every relay refusing starts the refusal clock, any relay taking or not
// answering stops it.
function afterSend(state: WatchState, sent: SendOutcome): WatchState {
  const { refusedSince: _refusedSince, ...rest } = state;
  const kept = sent.isRefused && state.isRefused ? state : rest;
  return { ...kept, transaction: sent.transaction, isRefused: sent.isRefused };
}

// While no relay has accepted the stored bytes, each wait sends them again, up to the limit.
async function sendIfUnsent(run: ExecutionRun, state: WatchState): Promise<WatchState> {
  if (state.transaction.state !== "signed" || state.sends >= run.parts.limits.sendAttempts) {
    return state;
  }
  const sent = await sendOnce(run, state.intent, state.transaction);
  return { ...afterSend(state, sent), sends: state.sends + 1 };
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
function dueRule(state: WatchState, head: bigint, limits: ExecutionRun["parts"]["limits"]) {
  const { stuckAfterBlocks, replaceAfterBlocks } = limits;
  const blocks = head - (state.firstBlock ?? head);
  if (blocks >= BigInt(replaceAfterBlocks)) {
    return "replace";
  }
  return blocks >= BigInt(stuckAfterBlocks) && !state.isResent ? "resend" : undefined;
}

// A step no rule can move waits handed over: a nonce something else used ends the watch at once,
// any other reason lets the drop rule run its course first.
function handOver(state: WatchState, head: bigint, problem: string): WatchState | Watched {
  if (problem === "nonce_used" || problem === "no_step") {
    return { outcome: "stuck", transaction: state.transaction, problem };
  }
  return { ...state, handedOver: { problem, atBlock: head }, lastSendBlock: head };
}

// A rule's move becomes the watch's next state, or ends the watch.
async function afterMove(
  run: ExecutionRun,
  at: { readonly state: WatchState; readonly head: bigint },
  move: StuckMove,
): Promise<WatchState | Watched> {
  const { state, head } = at;
  if (move.kind === "landed") {
    return settle(run, move);
  }
  if (move.kind === "stopped") {
    return handOver(state, head, move.problem);
  }
  if (move.kind === "resent") {
    return { ...afterSend(state, move), isResent: true };
  }
  if (move.kind === "waiting") {
    return state;
  }
  const { firstBlock: _firstBlock, ...rest } = afterSend(state, move);
  const rivals = [...state.rivals, state.transaction];
  return { ...rest, rivals, sends: 1, isResent: false };
}

// The drop rule (decision 0115): every relay refused the step's bytes for `droppedAfterBlocks`
// blocks, so it is dropped once its nonce is still free. While a relay may hold a transaction the
// step replaced, the watch goes on as it was.
async function dropDue(run: ExecutionRun, state: WatchState): Promise<WatchState | Watched> {
  const dropped = await dropStep(run, state);
  if (dropped.kind === "landed") {
    return settle(run, dropped);
  }
  if (dropped.kind === "dropped") {
    return { outcome: "dropped", transaction: dropped.transaction };
  }
  return dropped.kind === "taken"
    ? { outcome: "stuck", transaction: state.transaction, problem: "nonce_used" }
    : state;
}

// The step keeps its nonce, so every later step of the wallet would wait behind it: the wallet's
// queue stays with the step, and the owner hears why once.
function holdWallet(run: ExecutionRun, state: WatchState, problem: string): WatchState {
  const { id, agentId } = state.intent;
  run.parts.log.warn("executor.step_stopped", { intentId: id, errorCode: problem });
  const wallet = accountRefParts(state.transaction.account).address;
  const notice = { key: heldNoticeKey, agent: agentId, intent: id, values: { wallet } };
  run.parts.publish(noticePush(notice));
  return { ...state, isHeld: true };
}

// A step handed over gets the same bytes again each `stuckAfterBlocks` blocks, so the relays'
// answers keep the drop rule's clock. Once `droppedAfterBlocks` blocks end its wait, it holds the
// wallet until a block holds it or the drop rule drops it.
async function waitHandedOver(
  run: ExecutionRun,
  state: WatchState & {
    readonly handedOver: { readonly problem: string; readonly atBlock: bigint };
  },
  head: bigint,
): Promise<WatchState | Watched> {
  const { stuckAfterBlocks, droppedAfterBlocks } = run.parts.limits;
  const { problem, atBlock } = state.handedOver;
  if (state.isHeld !== true && head - atBlock >= BigInt(droppedAfterBlocks)) {
    return holdWallet(run, state, problem);
  }
  if (head - (state.lastSendBlock ?? atBlock) < BigInt(stuckAfterBlocks)) {
    return state;
  }
  const sent = await sendOnce(run, state.intent, state.transaction);
  return { ...afterSend(state, sent), lastSendBlock: head };
}

// Due once every relay refused the step's bytes for `droppedAfterBlocks` blocks.
function isDropDue(run: ExecutionRun, state: WatchState, head: bigint): boolean {
  const { refusedSince } = state;
  return (
    refusedSince !== undefined && head - refusedSince >= BigInt(run.parts.limits.droppedAfterBlocks)
  );
}

// What the head says now: a drop that is due, a wait handed over, or a stuck rule.
async function atHead(
  run: ExecutionRun,
  rules: StuckRules | undefined,
  at: { readonly state: WatchState; readonly head: bigint },
): Promise<WatchState | Watched> {
  const { head } = at;
  const state = isDropDue(run, at.state, head) ? await dropDue(run, at.state) : at.state;
  if ("outcome" in state) {
    return state;
  }
  if (state.handedOver !== undefined) {
    return waitHandedOver(run, { ...state, handedOver: state.handedOver }, head);
  }
  const rule = dueRule(state, head, run.parts.limits);
  if (rule === undefined) {
    return state;
  }
  if (rules === undefined) {
    return handOver(state, head, "stuck");
  }
  return afterMove(run, { state, head }, await rules({ ...state, rule }));
}

// One block's look: a receipt of any of the step's transactions ends the watch; then the head.
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
  if (head === undefined) {
    return state;
  }
  const seen = {
    ...state,
    firstBlock: state.firstBlock ?? head.latest,
    waits: 0,
    ...(state.isRefused ? { refusedSince: state.refusedSince ?? head.latest } : {}),
  };
  return atHead(run, rules, { state: seen, head: head.latest });
}

async function watchFrom(
  run: ExecutionRun,
  rules: StuckRules | undefined,
  before: WatchState,
): Promise<Watched> {
  if (before.waits >= run.parts.limits.stuckAfterBlocks * 3) {
    const problem = before.handedOver?.problem ?? "stuck";
    return { outcome: "stuck", transaction: before.transaction, problem };
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
 * is stuck, `rules` move it on (spec 6, section 6). A step no rule can move, or any stuck step
 * without rules, as in recovery, which never signs, waits handed over and gets the same bytes
 * again each `stuckAfterBlocks` blocks. Once every relay has refused the step's bytes for
 * `droppedAfterBlocks` blocks and its nonce is still free, the step is `dropped` (decision 0115).
 * A step that waited handed over that long without it holds its wallet: the watch goes on, the
 * owner gets `notice.walletHeld`, and no later step of the wallet signs behind it. A watch that
 * cannot read the head for three times `stuckAfterBlocks` blocks in a row, or whose step's nonce
 * another transaction used, hands the step over as `stuck`.
 */
export async function sendAndWatch(
  run: ExecutionRun,
  step: NonceTransactions & { readonly intent: IntentRecord; readonly rules?: StuckRules },
): Promise<Watched> {
  const { intent, transaction, rivals, rules } = step;
  const state = { intent, transaction, rivals, sends: 0, waits: 0, isResent: false };
  return watchFrom(run, rules, { ...state, isRefused: false });
}
