import { err, type Id, ok, type Result } from "@binference/core";
import {
  type FillsInFlightQuery,
  inFlightStates,
  isFillAuthorized,
} from "../intents/fills-in-flight.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { LateLanding } from "../intents/late-landing.js";
import { type MemoryFillStores, ordersOf, rulesOf } from "./memory-fill-writes.js";
import type { MemoryIntentTables } from "./memory-intent-tables.js";

/** The memory intent store's late landings, with the tables, orders and rules beside them. */
export interface MemoryLandings {
  readonly tables: MemoryIntentTables;
  readonly landings: Map<Id<"int">, LateLanding>;
  /**
   * The order and rule stores beside the intents, which a landing that counts a fill on its order
   * or ends a rule fill's alert writes.
   */
  readonly stores: MemoryFillStores;
}

// A live fill of an order or a rule of the agent that holds its line, as the SQLite store's query
// reads it: in flight, or dropped and still watched with no landing, and not yet counted on its
// order or alert.
function holdsLine(
  intent: IntentRecord,
  query: FillsInFlightQuery & {
    readonly isLanded: boolean;
    readonly isCounted: boolean;
  },
): boolean {
  const isDroppedWatch =
    intent.state === "failed_onchain" &&
    intent.reason === "stuck_dropped" &&
    intent.changedAtMs >= query.droppedSinceMs &&
    !query.isLanded;
  const isLiveFill =
    !intent.isPaper && intent.proposer === "engine" && isFillAuthorized(intent.authorizedBy);
  return (
    intent.agentId === query.agentId &&
    isLiveFill &&
    !query.isCounted &&
    (inFlightStates.includes(intent.state) || isDroppedWatch)
  );
}

/** The agent's live order and rule fills that hold its line (decisions 0211 and 0342). */
export function fillsInFlightOf(
  store: MemoryLandings,
  query: FillsInFlightQuery,
): readonly IntentRecord[] {
  return store.tables.intents().filter((intent) =>
    holdsLine(intent, {
      ...query,
      isLanded: store.landings.has(intent.id),
      isCounted:
        store.stores.orders?.isCountedNow(intent.id) === true ||
        store.stores.webhookRules?.isFilledByNow(intent.id) === true,
    }),
  );
}

/**
 * One late landing per known intent (decision 0147), with its order's write when it counts a fill
 * (decision 0211) or its alert's when it ends a rule fill (decision 0342): `stale` when the order,
 * the alert or the rule moved since it was read, and nothing is written.
 */
export function recordLandedLate(
  store: MemoryLandings,
  landing: LateLanding,
): Result<LateLanding, "exists" | "not_found" | "stale"> {
  const { tables, landings, stores } = store;
  if (tables.intent(landing.intentId) === undefined) {
    return err("not_found");
  }
  if (landings.has(landing.intentId)) {
    return err("exists");
  }
  const { order, alert } = landing;
  const by = { intent: landing.intentId, isLanding: true };
  if (alert !== undefined && !rulesOf(stores).checkFillNow(alert, by).ok) {
    return err("stale");
  }
  if (order !== undefined) {
    const moved = ordersOf(stores).checkWriteNow(order);
    if (!moved.ok) {
      return err("stale");
    }
    ordersOf(stores).saveNow(moved.value);
    ordersOf(stores).saveFillNow(order.fill);
  }
  if (alert !== undefined) {
    rulesOf(stores).saveFillNow(alert, by);
  }
  landings.set(landing.intentId, structuredClone(landing));
  return ok(landing);
}
