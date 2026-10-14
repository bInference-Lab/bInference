import { err, type Id, ok, type Result } from "@binference/core";
import {
  type FillsInFlightQuery,
  inFlightStates,
  isOrderAuthorized,
} from "../intents/fills-in-flight.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { LateLanding } from "../intents/late-landing.js";
import { constraintFault } from "./memory-call.js";
import type { MemoryIntentTables } from "./memory-intent-tables.js";
import type { MemoryOrderStore } from "./memory-order-store.js";

/** The memory intent store's late landings, with the tables and the orders beside them. */
export interface MemoryLandings {
  readonly tables: MemoryIntentTables;
  readonly landings: Map<Id<"int">, LateLanding>;
  /** The order store beside the intents, which a landing that counts a fill writes. */
  readonly orders: MemoryOrderStore | undefined;
}

// A live order fill of the agent that holds its line, as the SQLite store's query reads it: in
// flight, or dropped and still watched with no landing, and not yet counted on its order.
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
    !intent.isPaper && intent.proposer === "engine" && isOrderAuthorized(intent.authorizedBy);
  return (
    intent.agentId === query.agentId &&
    isLiveFill &&
    !query.isCounted &&
    (inFlightStates.includes(intent.state) || isDroppedWatch)
  );
}

/** The agent's live order fills that hold its line (decision 0211), in table order. */
export function fillsInFlightOf(
  store: MemoryLandings,
  query: FillsInFlightQuery,
): readonly IntentRecord[] {
  return store.tables.intents().filter((intent) =>
    holdsLine(intent, {
      ...query,
      isLanded: store.landings.has(intent.id),
      isCounted: store.orders?.isCountedNow(intent.id) === true,
    }),
  );
}

/**
 * One late landing per known intent (decision 0147), with its order's write when it counts a fill
 * (decision 0211): `stale` when the order moved since it was read, and nothing is written.
 */
export function recordLandedLate(
  store: MemoryLandings,
  landing: LateLanding,
): Result<LateLanding, "exists" | "not_found" | "stale"> {
  const { tables, landings, orders } = store;
  if (tables.intent(landing.intentId) === undefined) {
    return err("not_found");
  }
  if (landings.has(landing.intentId)) {
    return err("exists");
  }
  const { order } = landing;
  if (order !== undefined) {
    if (orders === undefined) {
      throw constraintFault("a write moves orders this store holds none of");
    }
    const moved = orders.checkWriteNow(order);
    if (!moved.ok) {
      return err("stale");
    }
    orders.saveNow(moved.value);
    orders.saveFillNow(order.fill);
  }
  landings.set(landing.intentId, structuredClone(landing));
  return ok(landing);
}
