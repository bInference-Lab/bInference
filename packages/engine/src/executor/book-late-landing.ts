import type { TxReceipt } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { fillOrderOf } from "../orders/fill-ends.js";
import { moveOrder } from "../orders/order-machine.js";
import { orderPush } from "../orders/order-view-of.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, nextBlock, readSafely } from "./executor-run.js";
import { type BookedTrade, bookTrade } from "./reconcile-trade.js";
import { currentSteps } from "./recover-steps.js";
import { recordReceipt } from "./run-step.js";

/** A dropped step's transaction a block holds after all, with its receipt. */
export interface Landed {
  readonly transaction: TransactionRecord;
  readonly receipt: TxReceipt;
}

// Every step of the plan in a block that ran it: only then did the trade happen.
function isWholeTrade(run: ExecutionRun, steps: readonly TransactionRecord[]): boolean {
  return (
    steps.length === run.plan.steps.length &&
    steps.every(({ state }) => state === "included" || state === "final")
  );
}

// Each step final in the block it was found in, waiting at most `finalAfterBlocks` blocks; a step
// a reorg moved or took out leaves the trade unbooked.
async function finalizeSteps(
  run: ExecutionRun,
  steps: readonly TransactionRecord[],
  waits = 0,
): Promise<boolean> {
  const { parts, plan, signal } = run;
  const { receipts } = plan.sending;
  const highest = steps.reduce((most, { receipt }) => {
    const block = receipt?.block.number ?? 0n;
    return block > most ? block : most;
  }, 0n);
  const head = await readSafely(run, async () => receipts.head(plan.chain.ref, { signal }));
  if (head === undefined || head.final < highest) {
    if (waits >= parts.limits.finalAfterBlocks) {
      return false;
    }
    await nextBlock(run);
    return finalizeSteps(run, steps, waits + 1);
  }
  const reread = await Promise.all(
    steps.map(async ({ hash }) => receipts.receipt(plan.chain.ref, hash, { signal })),
  );
  if (reread.some((receipt, index) => receipt?.block.hash !== steps[index]?.receipt?.block.hash)) {
    return false;
  }
  const pending = steps.filter(({ state }) => state !== "final");
  const marked = await Promise.all(
    pending.map(async ({ id }) =>
      parts.stores.transactions.recordFinal({ id, atMs: parts.clock.now() }, { signal }),
    ),
  );
  return marked.every(({ ok }) => ok);
}

// The trade into the positions, again each block while a read or a price fails.
async function bookAgain(
  run: ExecutionRun,
  landed: { readonly snapshot: IntentSnapshot; readonly atMs: number },
  tries = 0,
): Promise<BookedTrade | "waiting" | "stopped"> {
  const booked = await bookTrade(run, landed.snapshot, landed.atMs);
  if (booked !== "waiting" || tries >= run.parts.limits.settleAfterBlocks) {
    return booked;
  }
  await nextBlock(run);
  return bookAgain(run, landed, tries + 1);
}

/**
 * Books a dropped step that landed after all (decision 0147). Its receipt is recorded, and a late
 * landing linked to the intent, which stays `failed_onchain`, makes the rolling 24-hour cap count
 * the intent again at once. Once every step of the plan is in a block and those blocks are final,
 * the trade goes into the positions and realized P&L as a reconciliation books it, and an order's
 * fill counts on its order; a trade whose steps did not all land, or whose block a reorg moved, is
 * logged and left out of the positions.
 */
export async function bookLateLanding(
  run: ExecutionRun,
  dropped: IntentSnapshot,
  landed: Landed,
): Promise<void> {
  const { parts, signal } = run;
  const intentId = dropped.record.id;
  const atMs = parts.clock.now();
  const transaction = await recordReceipt(run, landed.transaction, landed.receipt);
  const landing = { intentId, txId: transaction.id, atMs };
  const linked = await parts.stores.intents.recordLandedLate(landing, { signal });
  if (!linked.ok) {
    parts.log.warn("executor.landed_late_linked", { intentId, errorCode: linked.error });
  }
  const stored = await parts.stores.transactions.ofIntent(intentId, { signal });
  const steps = [...currentSteps(stored).values()];
  if (!isWholeTrade(run, steps) || !(await finalizeSteps(run, steps))) {
    parts.log.warn("executor.landed_late_unbooked", { intentId });
    return;
  }
  await countLateFill(run, { dropped, atMs, left: countAttempts });
  const booked = await bookAgain(run, { snapshot: dropped, atMs });
  if (typeof booked !== "string") {
    parts.log.info("executor.landed_late_booked", { intentId });
  }
}

// A move of the order that lost its race is tried again on a fresh read, this many times in all.
const countAttempts = 3;

// An order's live fill that landed after its intent ended still counts on its order (decision
// 0210), so the order never fills past its fills; its intent stays `failed_onchain`.
async function countLateFill(
  run: ExecutionRun,
  late: { readonly dropped: IntentSnapshot; readonly atMs: number; readonly left: number },
): Promise<void> {
  const { parts, signal } = run;
  const { dropped, atMs, left } = late;
  const orderId = fillOrderOf(dropped);
  const order = orderId === undefined ? undefined : await parts.orders.get(orderId, { signal });
  const move = order === undefined ? undefined : moveOrder(order, { type: "fill_landed" }, atMs);
  if (move?.ok !== true) {
    return;
  }
  const moved = await parts.orders.move([move.value], { signal });
  const intentId = dropped.record.id;
  if (moved.ok) {
    parts.log.info("executor.landed_late_counted", { intentId });
    moved.value.forEach((counted) => {
      parts.publish(orderPush(counted, "order/changed"));
    });
    return;
  }
  if (left <= 1) {
    parts.log.error("executor.landed_late_uncounted", { intentId, errorCode: moved.error });
    return;
  }
  await countLateFill(run, { ...late, left: left - 1 });
}
