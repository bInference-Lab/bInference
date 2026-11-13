import { err, ok, type Result } from "@binference/core";
import type { FreezeWrite } from "../intents/freeze-write.js";
import type { OrderRecord } from "../orders/order-record.js";
import type { MemoryBreakerMark } from "./memory-breaker-mark.js";
import { type MemoryFillStores, ordersOf } from "./memory-fill-writes.js";

/**
 * A freeze's order moves, checked as they would land after its agents are marked: an owner's
 * freeze an unfreeze lifts, or the breaker's hold its lift clears, counts as lifted. A refusal is
 * the freeze's `stale`, as the SQLite store's.
 */
export function checkFreezeOrders(
  stores: MemoryFillStores,
  write: FreezeWrite,
): Result<readonly OrderRecord[], "stale"> {
  if (write.orders.length === 0) {
    return ok([]);
  }
  const agents = new Set(write.isFrozen ? [] : write.agents.map(({ agentId }) => agentId));
  const isBreakerLifted = write.breaker?.isPulled === false;
  const checked = ordersOf(stores).checkNow(write.orders, { agents, isBreakerLifted });
  return checked.ok ? checked : err("stale");
}

/**
 * A freeze's breaker part, checked against the install's mark (decision 0440): one planned on
 * another version than the install holds, or at or below it, is `stale`. Answers the write to
 * make once the rest of the freeze passed.
 */
export function checkFreezeBreaker(
  mark: MemoryBreakerMark,
  write: FreezeWrite,
): Result<() => void, "stale"> {
  const { breaker } = write;
  if (breaker === undefined) {
    return ok(() => undefined);
  }
  return mark.check(breaker).ok
    ? ok(() => {
        mark.write(breaker, write.atMs);
      })
    : err("stale");
}
