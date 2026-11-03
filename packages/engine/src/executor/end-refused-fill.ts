import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { announceOrder, fillOrderOf, fillRuleOf, skipRowOf } from "../orders/fill-ends.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import { announceAlerts, skipWriteOf } from "../webhooks/end-alert.js";
import type { ExecutionRun } from "./executor-run.js";

/** A refused fill's write on its order or its rule's alert, and what tells the owner after it. */
interface RefusedEnd {
  readonly write: Pick<IntentMove, "order" | "alert">;
  readonly announce: () => Promise<void>;
}

// The rule fill's write on its alert (decision 0342), at `atMs`, with the notice the owner hears,
// what the agent used of the rolling cap for a skip for the cap; `undefined` when its rule is gone.
async function ruleRefusedEndOf(
  run: ExecutionRun,
  refused: { readonly snapshot: IntentSnapshot; readonly reason: OrderFillReason },
  atMs: number,
): Promise<RefusedEnd | undefined> {
  const { parts, signal } = run;
  const { snapshot, reason } = refused;
  const { rules, clock, publish } = parts;
  const ruleFill = fillRuleOf(snapshot);
  const rule = ruleFill === undefined ? undefined : await rules.get(ruleFill.rule, { signal });
  if (ruleFill === undefined || rule === undefined) {
    return undefined;
  }
  const capUsdMicros = snapshot.settings.limits.rollingDayUsdMicros;
  const cap =
    reason === "daily_cap"
      ? { cap: { usedUsdMicros: await parts.spent(snapshot, { signal }), capUsdMicros } }
      : {};
  const skip = { event: ruleFill.event, reason, intentId: snapshot.record.id, tells: true, ...cap };
  const alert = await skipWriteOf({ rules }, { rule, skip, atMs, signal });
  const announce = async () => {
    const ended = await rules.alert(ruleFill.event, { signal });
    await announceAlerts({ rules, clock, publish }, ended === undefined ? [] : [ended], signal);
  };
  return { write: { alert }, announce };
}

// The skip's row on its order, with the notice the owner hears and what the agent used of the
// rolling cap for a skip for the cap, or its rule's alert's end; `undefined` when its order or
// rule is gone.
async function refusedEndOf(
  run: ExecutionRun,
  refused: { readonly snapshot: IntentSnapshot; readonly reason: OrderFillReason },
  atMs: number,
): Promise<RefusedEnd | undefined> {
  const { parts, signal } = run;
  const { snapshot, reason } = refused;
  const { orders, clock, publish } = parts;
  const orderId = fillOrderOf(snapshot);
  const order = orderId === undefined ? undefined : await orders.get(orderId, { signal });
  if (order === undefined) {
    return ruleRefusedEndOf(run, refused, atMs);
  }
  const skip = { order, reason, intent: snapshot, atMs, signal };
  const fill = await skipRowOf({ orders, ids: parts.ids, spent: parts.spent }, skip);
  const announce = async () => {
    await announceOrder({ orders, clock, publish }, order.id, signal);
  };
  return { write: { order: { moves: [], fill } }, announce };
}

/**
 * Ends a confirmed live fill the queue refuses at once, unsigned (decisions 0211 and 0342): its
 * order or rule no longer holds its grant, live fills are off, its agent is not live, or the policy
 * refuses it now, a skip for the cap telling what the agent used of it. The intent is cancelled with its order's skip row, or its rule's alert ended as a
 * skip, which names the reason and carries the owner's notice, in one write, so its agent's fill
 * line is free at once.
 */
export async function endRefusedFill(
  run: ExecutionRun,
  refused: { readonly snapshot: IntentSnapshot; readonly reason: OrderFillReason },
): Promise<void> {
  const { parts, signal } = run;
  const { snapshot } = refused;
  const ended = await refusedEndOf(run, refused, parts.clock.now());
  if (ended === undefined) {
    return;
  }
  const trigger = { type: "cancel_requested", cause: "request", hasSignedStep: false } as const;
  const step = parts.machine.apply(snapshot.stored.status, trigger);
  if (!step.ok) {
    return;
  }
  const move = { intent: snapshot.record.id, version: snapshot.stored.version, step: step.value };
  const moved = await parts.stored.move({ ...move, by: "engine", ...ended.write }, { signal });
  if (moved.ok) {
    await ended.announce();
  }
}
