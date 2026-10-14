import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { announceOrder, fillOrderOf } from "../orders/fill-ends.js";
import { landedFillWrite } from "../orders/fill-landed.js";
import { orderPush } from "../orders/order-view-of.js";
import { noticePush } from "../pushes/notice-push.js";
import type { ExecutionRun } from "./executor-run.js";

// The owner's notice of a fill counted on its order before its trade could be valued.
const unvaluedNoticeKey = "notice.fillUnvalued";

/**
 * Counts an order's live fill whose every step is final on its order, apart from the move that
 * would reconcile it, once reconciliation could not value its trade within the settle wait or no
 * node can say what it received (decision 0211): its order's `fill_landed` move and `filled` row,
 * as its confirmed quote said it would trade, in one write, so its agent's fill line is free and
 * the order never fills again before it. The owner hears it once; the reconciling move that comes
 * later counts nothing more. Any other intent, or one counted already, is left as it is.
 */
export async function countUnsettledFill(
  run: ExecutionRun,
  finalized: IntentSnapshot,
): Promise<void> {
  const { parts, signal } = run;
  const orderId = fillOrderOf(finalized);
  const { record } = finalized;
  const order = orderId === undefined ? undefined : await parts.orders.get(orderId, { signal });
  if (order === undefined || record.quote === undefined) {
    return;
  }
  const { amountIn, minOut } = quoteDocument.decode(record.quote);
  const settled = { amountIn, amountOut: minOut };
  const atMs = parts.clock.now();
  const call = { order, snapshot: finalized, settled, isBooked: false, atMs, signal };
  const write = await landedFillWrite(parts, call);
  const counted =
    write === undefined ? undefined : await parts.orders.recordLandedFill(write, { signal });
  if (counted?.ok !== true) {
    const errorCode = counted?.ok === false ? counted.error : "order_refused";
    parts.log.warn("executor.fill_uncounted", { intentId: record.id, errorCode });
    return;
  }
  parts.log.warn("executor.fill_counted_unvalued", { intentId: record.id });
  counted.value.forEach((moved) => parts.publish(orderPush(moved, "order/changed")));
  const { orders, clock, publish } = parts;
  await announceOrder({ orders, clock, publish }, order.id, signal);
  const notice = { key: unvaluedNoticeKey, agent: record.agentId, intent: record.id, values: {} };
  publish(
    noticePush({
      ...notice,
      parts: { orderKind: { key: "order.kind", values: { kind: order.kind } } },
    }),
  );
}
