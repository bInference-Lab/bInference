import { isAnswering } from "./webhook-alert.js";
import type { WebhookRuleParts } from "./webhook-rule-parts.js";

// The most active rules one tick reads; the next tick ends the rest.
const pageSize = 1_000;

/**
 * Ends each active rule past its expiry as `deleted` (decision 0337): its URL answers nothing from
 * its expiry on, and it leaves the 20-rule count and `webhookRule/list`. It tells nothing: the
 * owner set the expiry. A rule another write moved first is left for the next tick.
 */
export async function endExpiredRules(
  parts: Pick<WebhookRuleParts, "rules" | "clock">,
  signal: AbortSignal,
): Promise<void> {
  const nowMs = parts.clock.now();
  const active = await parts.rules.list({ states: ["active"], limit: pageSize }, { signal });
  const expired = active.filter((rule) => !isAnswering(rule, nowMs));
  // One write at a time, so a run holds one store write at once.
  await expired.reduce<Promise<void>>(async (done, rule) => {
    await done;
    const move = { id: rule.id, expectedVersion: rule.version, atMs: nowMs };
    await parts.rules.move({ ...move, state: "deleted" }, { signal });
  }, Promise.resolve());
}
