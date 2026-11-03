import type { TxReceipt } from "@binference/chain";
import type { Id } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { LateLanding } from "../intents/late-landing.js";
import { announceOrder, fillOrderOf, fillRuleOf } from "../orders/fill-ends.js";
import { landedFillWrite } from "../orders/fill-landed.js";
import type { OrderFillWrite } from "../orders/order-fill.js";
import { orderPush } from "../orders/order-view-of.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { AlertFillWrite } from "../webhooks/alert-fill-record.js";
import { announceAlerts } from "../webhooks/end-alert.js";
import { landedRuleFillWrite } from "../webhooks/rule-fill-landed.js";
import { bridgeQuoteOf } from "./bridge-queue-check.js";
import { type ExecutionRun, nextBlock, readSafely } from "./executor-run.js";
import { departLateLanding } from "./reconcile-finalized.js";
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

// Every step of a bridge's plan in a block, ran or reverted: its gas is spent either way, and only
// a deposit that ran moved the token (decision 0320).
function isBridgeInBlocks(
  run: ExecutionRun,
  dropped: IntentSnapshot,
  steps: readonly TransactionRecord[],
): boolean {
  return (
    bridgeQuoteOf(dropped.record) !== undefined &&
    steps.length === run.plan.steps.length &&
    steps.every(({ state }) => state === "included" || state === "final" || state === "reverted")
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
  const pending = steps.filter(({ state }) => state === "included");
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

// A move of the order that lost its race is tried again on a fresh read, this many times in all.
const linkAttempts = 3;

// The order write of an order's live fill whose dropped step landed after all, the whole trade in
// blocks: its count on its order, as its confirmed quote said it would trade, the trade not yet in
// the positions (decision 0211). `undefined` for any other intent, or an order gone.
async function lateFillWrite(
  run: ExecutionRun,
  late: { readonly dropped: IntentSnapshot; readonly atMs: number },
): Promise<OrderFillWrite | undefined> {
  const { parts, signal } = run;
  const { dropped, atMs } = late;
  const orderId = fillOrderOf(dropped);
  const order = orderId === undefined ? undefined : await parts.orders.get(orderId, { signal });
  const quote = dropped.record.quote;
  if (order === undefined || quote === undefined) {
    return undefined;
  }
  const { amountIn, minOut } = quoteDocument.decode(quote);
  const settled = { amountIn, amountOut: minOut };
  const call = { order, snapshot: dropped, settled, isBooked: false, atMs, signal };
  return landedFillWrite(parts, call);
}

// The alert write of a rule's live fill whose dropped step landed after all, the whole trade in
// blocks: its alert `filled` over its drop's skip, counted on its rule, as its confirmed quote said
// it would trade (decision 0342). `undefined` for any other intent, or a rule gone.
async function lateRuleFillWrite(
  run: ExecutionRun,
  late: { readonly dropped: IntentSnapshot; readonly atMs: number },
): Promise<AlertFillWrite | undefined> {
  const { parts, signal } = run;
  const { dropped, atMs } = late;
  const fill = fillRuleOf(dropped);
  const rule = fill === undefined ? undefined : await parts.rules.get(fill.rule, { signal });
  const quote = dropped.record.quote;
  if (fill === undefined || rule === undefined || quote === undefined) {
    return undefined;
  }
  const { amountIn, minOut } = quoteDocument.decode(quote);
  const settled = { amountIn, amountOut: minOut };
  const landed = { intents: parts.stores.intents, prices: parts.prices, chains: parts.chains };
  return landedRuleFillWrite(landed, {
    rule,
    event: fill.event,
    snapshot: dropped,
    settled,
    atMs,
    signal,
  });
}

// Links the late landing, with an order's fill or a rule's alert counted in the same write when
// the whole trade landed; a write that lost a race to another of its order or rule is tried again
// on a fresh read. A second landing of one intent links and counts nothing more.
async function linkLanding(
  run: ExecutionRun,
  late: {
    readonly dropped: IntentSnapshot;
    readonly landing: LateLanding;
    readonly isWhole: boolean;
    readonly left: number;
  },
): Promise<void> {
  const { parts, signal } = run;
  const { dropped, landing, isWhole, left } = late;
  const landed = { dropped, atMs: landing.atMs };
  const order = isWhole ? await lateFillWrite(run, landed) : undefined;
  const alert = isWhole && order === undefined ? await lateRuleFillWrite(run, landed) : undefined;
  const write = {
    ...landing,
    ...(order === undefined ? {} : { order }),
    ...(alert === undefined ? {} : { alert }),
  };
  const linked = await parts.stores.intents.recordLandedLate(write, { signal });
  const intentId = landing.intentId;
  if (linked.ok) {
    await announceCount(run, order === undefined ? { intentId } : { intentId, order });
    await announceRuleCount(run, alert);
    return;
  }
  if (linked.error === "stale" && left > 1) {
    await linkLanding(run, { ...late, left: left - 1 });
    return;
  }
  parts.log.warn("executor.landed_late_linked", { intentId, errorCode: linked.error });
}

// The owner hears a late fill counted on its order; a count past the order's most fills is an
// error the owner's alarm on the row names too.
async function announceCount(
  run: ExecutionRun,
  counted: { readonly intentId: Id<"int">; readonly order?: OrderFillWrite },
): Promise<void> {
  const { order, intentId } = counted;
  if (order === undefined) {
    return;
  }
  const { parts, signal } = run;
  const { orders, clock, publish } = parts;
  const stored = await orders.get(order.fill.orderId, { signal });
  if (stored !== undefined) {
    publish(orderPush(stored, "order/changed"));
  }
  const isOver = stored?.maxFills !== undefined && stored.fills > stored.maxFills;
  parts.log[isOver ? "error" : "info"]("executor.landed_late_counted", { intentId });
  await announceOrder({ orders, clock, publish }, order.fill.orderId, signal);
}

// The owner hears a late rule fill counted on its alert.
async function announceRuleCount(run: ExecutionRun, alert: AlertFillWrite | undefined) {
  if (alert === undefined) {
    return;
  }
  const { parts, signal } = run;
  const { rules, clock, publish } = parts;
  const ended = await rules.alert(alert.event, { signal });
  parts.log.info("executor.landed_late_counted", { intentId: alert.intentId ?? "" });
  await announceAlerts({ rules, clock, publish }, ended === undefined ? [] : [ended], signal);
}

/**
 * Books a dropped step that landed after all (decision 0147). Its receipt is recorded, and a late
 * landing linked to the intent, which stays `failed_onchain`, makes the rolling 24-hour cap count
 * the intent again at once. An order's fill whose whole trade is in blocks counts on its order in
 * that same write, once (decision 0211), and a rule's fill on its alert and rule (decision 0342). Once every step of the plan is in a block and those
 * blocks are final, the trade goes into the positions and realized P&L as a reconciliation books
 * it, and a send's, a revoke's or a bridge's as its departures, a bridge's with a reverted deposit
 * as its gas alone; a trade whose steps did not all land, or whose
 * block a reorg moved, is logged and left out of the positions.
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
  const stored = await parts.stores.transactions.ofIntent(intentId, { signal });
  const steps = [...currentSteps(stored).values()];
  const isWhole = isWholeTrade(run, steps);
  const landing = { intentId, txId: transaction.id, atMs };
  await linkLanding(run, { dropped, landing, isWhole, left: linkAttempts });
  const isBooked = isWhole || isBridgeInBlocks(run, dropped, steps);
  if (!isBooked || !(await finalizeSteps(run, steps))) {
    parts.log.warn("executor.landed_late_unbooked", { intentId });
    return;
  }
  // A send, a revoke or a bridge books no trade: what its steps took out leaves the positions.
  if ((await departLateLanding(run, dropped)) !== "trade") {
    return;
  }
  const booked = await bookAgain(run, { snapshot: dropped, atMs });
  if (typeof booked !== "string") {
    parts.log.info("executor.landed_late_booked", { intentId });
  }
}
