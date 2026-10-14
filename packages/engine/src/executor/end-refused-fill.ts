import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { announceOrder, fillOrderOf, skipRowOf } from "../orders/fill-ends.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import type { ExecutionRun } from "./executor-run.js";

/**
 * Ends a confirmed live fill the queue refuses at once, unsigned (decision 0211): its order no
 * longer holds its grant, live fills are off, its agent is not live, or the policy refuses it now.
 * The intent is cancelled with its skip's row, which names the reason and carries the owner's
 * notice, in one write, so its agent's fill line is free at once.
 */
export async function endRefusedFill(
  run: ExecutionRun,
  refused: { readonly snapshot: IntentSnapshot; readonly reason: OrderFillReason },
): Promise<void> {
  const { parts, signal } = run;
  const { snapshot, reason } = refused;
  const orderId = fillOrderOf(snapshot);
  const order = orderId === undefined ? undefined : await parts.orders.get(orderId, { signal });
  if (order === undefined) {
    return;
  }
  const atMs = parts.clock.now();
  const skip = { order, reason, intent: snapshot, atMs, signal };
  const fill = await skipRowOf({ orders: parts.orders, ids: parts.ids }, skip);
  const trigger = { type: "cancel_requested", cause: "request", hasSignedStep: false } as const;
  const step = parts.machine.apply(snapshot.stored.status, trigger);
  if (!step.ok) {
    return;
  }
  const move = { intent: snapshot.record.id, version: snapshot.stored.version, step: step.value };
  const moved = await parts.stored.move(
    { ...move, by: "engine", order: { moves: [], fill } },
    { signal },
  );
  if (moved.ok) {
    const { orders, clock, publish } = parts;
    await announceOrder({ orders, clock, publish }, order.id, signal);
  }
}
