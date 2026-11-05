import { err, type Result } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { announceOrder, fillOrderOf, fillRuleOf } from "../orders/fill-ends.js";
import { landedFillWrite, type LandedTrade } from "../orders/fill-landed.js";
import type { OrderRecord } from "../orders/order-record.js";
import { orderPush } from "../orders/order-view-of.js";
import { type NoticePart, noticePush } from "../pushes/notice-push.js";
import { ruleOrderKind } from "../webhooks/alert-fill-notices.js";
import { announceAlerts } from "../webhooks/end-alert.js";
import { landedRuleFillWrite } from "../webhooks/rule-fill-landed.js";
import type { ExecutionRun } from "./executor-run.js";

// The owner's notice of a fill counted on its order before its trade could be valued.
const unvaluedNoticeKey = "notice.fillUnvalued";

// How many times a count that lost its order's or rule's version to another write, such as another
// fill or a skip told in the rule's notice hour, is read and written again.
const countTries = 3;

// The count's write on the order as read now, and what the order store answered it; `undefined`
// when the intent fills no stored order, `order_refused` when the order cannot take the fill.
async function countOnce(
  run: ExecutionRun,
  call: { readonly finalized: IntentSnapshot; readonly settled: LandedTrade },
): Promise<
  | {
      readonly order: OrderRecord;
      readonly counted: Result<readonly OrderRecord[], "counted" | "stale" | "order_refused">;
    }
  | undefined
> {
  const { parts, signal } = run;
  const { finalized, settled } = call;
  const orderId = fillOrderOf(finalized);
  const order = orderId === undefined ? undefined : await parts.orders.get(orderId, { signal });
  if (order === undefined) {
    return undefined;
  }
  const atMs = parts.clock.now();
  const landing = { order, snapshot: finalized, settled, isBooked: false, atMs, signal };
  const write = await landedFillWrite(parts, landing);
  const counted =
    write === undefined
      ? err("order_refused" as const)
      : await parts.orders.recordLandedFill(write, { signal });
  return { order, counted };
}

// Counts an order's fill as its quote said it would trade, in one write on its order; answers the
// order's kind as its notice names it, or `undefined` when the order cannot take it. A count that
// lost its order's version to another write, such as another fill, is tried again on a fresh read.
async function countOnOrder(
  run: ExecutionRun,
  call: { readonly finalized: IntentSnapshot; readonly settled: LandedTrade },
  tries: number = countTries,
): Promise<NoticePart | undefined> {
  const { parts, signal } = run;
  const once = await countOnce(run, call);
  if (once === undefined) {
    return undefined;
  }
  const { order, counted } = once;
  if (!counted.ok && counted.error === "stale" && tries > 1) {
    return countOnOrder(run, call, tries - 1);
  }
  if (!counted.ok) {
    const errorCode = counted.error;
    parts.log.warn("executor.fill_uncounted", { intentId: call.finalized.record.id, errorCode });
    return undefined;
  }
  counted.value.forEach((moved) => parts.publish(orderPush(moved, "order/changed")));
  const { orders, clock, publish } = parts;
  await announceOrder({ orders, clock, publish }, order.id, signal);
  return { key: "order.kind", values: { kind: order.kind } };
}

// Counts a rule's fill as its quote said it would trade, ending its alert `filled` alone (decision
// 0342); answers the rule as its notice names it, or `undefined` when the alert cannot take it. A
// count that lost its rule's version is tried again on a fresh read.
async function countOnRule(
  run: ExecutionRun,
  call: { readonly finalized: IntentSnapshot; readonly settled: LandedTrade },
  tries: number = countTries,
): Promise<NoticePart | undefined> {
  const { parts, signal } = run;
  const { finalized, settled } = call;
  const fill = fillRuleOf(finalized);
  const rule = fill === undefined ? undefined : await parts.rules.get(fill.rule, { signal });
  if (fill === undefined || rule === undefined) {
    return undefined;
  }
  const landed = { intents: parts.stores.intents, prices: parts.prices, chains: parts.chains };
  const atMs = parts.clock.now();
  const landing = { rule, event: fill.event, snapshot: finalized, settled, atMs, signal };
  const ended = await parts.rules.endAlert(await landedRuleFillWrite(landed, landing), { signal });
  if (!ended.ok && ended.error === "stale" && tries > 1) {
    return countOnRule(run, call, tries - 1);
  }
  if (!ended.ok) {
    parts.log.warn("executor.fill_uncounted", {
      intentId: finalized.record.id,
      errorCode: ended.error,
    });
    return undefined;
  }
  const { rules, clock, publish } = parts;
  await announceAlerts({ rules, clock, publish }, [ended.value], signal);
  return ruleOrderKind(rule);
}

/**
 * Counts a live fill whose every step is final on its order, or on its rule's alert, apart from
 * the move that would reconcile it, once reconciliation could not value its trade within the
 * settle wait or no node can say what it received (decisions 0211 and 0342): as its confirmed
 * quote said it would trade, in one write, so its agent's fill line is free and its source never
 * fills again before it. The owner hears it once; the reconciling move that comes later counts
 * nothing more. Any other intent, or one counted already, is left as it is.
 */
export async function countUnsettledFill(
  run: ExecutionRun,
  finalized: IntentSnapshot,
): Promise<void> {
  const { parts } = run;
  const { record } = finalized;
  if (record.quote === undefined) {
    return;
  }
  const { amountIn, minOut } = quoteDocument.decode(record.quote);
  const call = { finalized, settled: { amountIn, amountOut: minOut } };
  const orderKind = (await countOnOrder(run, call)) ?? (await countOnRule(run, call));
  if (orderKind === undefined) {
    return;
  }
  parts.log.warn("executor.fill_counted_unvalued", { intentId: record.id });
  const notice = { key: unvaluedNoticeKey, agent: record.agentId, intent: record.id, values: {} };
  parts.publish(noticePush({ ...notice, parts: { orderKind } }));
}
