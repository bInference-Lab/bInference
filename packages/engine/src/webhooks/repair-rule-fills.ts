import type { Id } from "@binference/core";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { cancelUnsigned } from "../orders/cancel-order.js";
import { fillRuleOf } from "../orders/fill-ends.js";
import { unfinishedFills } from "../orders/fill-faults.js";
import { type AlertEndParts, endAlertSkipped } from "./end-alert.js";

/** What cancelling the rule fills a stop or a deadline left reads and writes through. */
export interface RepairRuleFillsParts extends AlertEndParts {
  readonly stored: StoredIntents;
}

// Cancels each fill unsigned and ends its alert `fill_failed`, told once per reason in a row; an
// alert another end came to first keeps it. Answers how many intents were cancelled.
async function cancelEach(
  parts: RepairRuleFillsParts,
  left: readonly IntentSnapshot[],
  call: { readonly cause: "request" | "engine_stopping"; readonly signal: AbortSignal },
): Promise<number> {
  const { cause, signal } = call;
  return left.reduce<Promise<number>>(async (counted, snapshot) => {
    const count = await counted;
    const fill = fillRuleOf(snapshot);
    if (fill === undefined) {
      return count;
    }
    await cancelUnsigned(parts, { intent: snapshot.record.id, cause }, signal);
    const skip = { event: fill.event, reason: "fill_failed" as const, tells: true };
    await endAlertSkipped(parts, {
      ruleId: fill.rule,
      skip: { ...skip, intentId: snapshot.record.id },
      signal,
    });
    return count + 1;
  }, Promise.resolve(0));
}

// The rule fills left before their write: a paper one before it filled, a live one before its
// confirmation; of one agent's alert when `event` names it.
async function leftFills(
  stored: StoredIntents,
  query: { readonly agentId?: Id<"agt">; readonly event?: number },
  signal: AbortSignal,
): Promise<readonly IntentSnapshot[]> {
  const isFill = (snapshot: IntentSnapshot): boolean => {
    const fill = fillRuleOf(snapshot);
    return fill !== undefined && (query.event === undefined || fill.event === query.event);
  };
  const agent = query.agentId === undefined ? {} : { agentId: query.agentId };
  const paper = await unfinishedFills(stored, { isPaper: true, ...agent, isFill }, { signal });
  const live = await unfinishedFills(stored, { isPaper: false, ...agent, isFill }, { signal });
  return [...paper, ...live];
}

/**
 * The start's repair of webhook rule fills (decision 0338), before anything fills an alert: every
 * rule fill a stop left before its write is cancelled unsigned, so its value leaves the rolling
 * cap, and its alert ends `fill_failed`, so a start within the alert's minute finds it ended and
 * never proposes a second intent for it. Answers how many intents it cancelled.
 */
export async function repairRuleFills(
  parts: RepairRuleFillsParts,
  options: { readonly signal: AbortSignal },
): Promise<number> {
  const { signal } = options;
  const left = await leftFills(parts.stored, {}, signal);
  return cancelEach(parts, left, { cause: "engine_stopping", signal });
}

/**
 * Cancels unsigned the intent an alert's fill stored before it threw or ran past its deadline, and
 * ends the alert `fill_failed` (decision 0338).
 */
export async function cancelAlertFill(
  parts: RepairRuleFillsParts,
  alert: { readonly agentId: Id<"agt">; readonly event: number },
  signal: AbortSignal,
): Promise<void> {
  const left = await leftFills(parts.stored, alert, signal);
  await cancelEach(parts, left, { cause: "request", signal });
}
