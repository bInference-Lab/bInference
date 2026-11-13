import type { OrderRecord } from "@binference/engine/orders";
import type { BreakerWrite, FreezeWrite } from "@binference/engine/safety";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";

/**
 * Whether the breaker's part of a write is `stale` (decision 0440): the install holds another
 * version than the one its plan read, or a version at or above its own. A write with no breaker
 * part never is.
 */
export function breakerStale(
  database: StoreConnection,
  breaker: BreakerWrite | undefined,
): boolean {
  if (breaker === undefined) {
    return false;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const safety = takeFirst(
    kysely.selectFrom("safety").select("breaker_version").where("id", "=", 1),
  );
  const applied = safety?.breaker_version ?? 0;
  return applied !== breaker.fromVersion || breaker.version <= applied;
}

/**
 * Writes the breaker's pull at `atMs`, keeping the time of a hold that holds already, or its lift,
 * at its version. A pull that takes hold keeps the row's time for the lift to look back from; a
 * version alone is told with its write.
 */
export function markBreaker(database: StoreConnection, write: FreezeWrite): void {
  const { breaker, atMs } = write;
  if (breaker === undefined) {
    return;
  }
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const safety = takeFirst(
    kysely.selectFrom("safety").select(["breaker_at", "breaker_pulled_at"]).where("id", "=", 1),
  );
  const heldAtMs = safety?.breaker_at ?? null;
  const takesHold = breaker.isPulled && heldAtMs === null;
  execute(
    kysely
      .updateTable("safety")
      .set((row) => ({
        breaker_at: breaker.isPulled ? (heldAtMs ?? atMs) : null,
        breaker_pulled_at: takesHold
          ? (breaker.changedAtMs ?? atMs)
          : (safety?.breaker_pulled_at ?? null),
        breaker_version: breaker.version,
        ...(breaker.isTold ? { breaker_told: breaker.version } : {}),
        version: row("version", "+", 1),
      }))
      .where("id", "=", 1),
  );
}

/**
 * Moves on the version of each agent whose orders the breaker's write moved, so an owner's freeze
 * or unfreeze planned before it, on the orders it read then, is `stale` (decision 0440).
 */
export function bumpAgents(
  database: StoreConnection,
  written: { readonly write: FreezeWrite; readonly orders: readonly OrderRecord[] },
): void {
  if (written.write.breaker === undefined) {
    return;
  }
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  for (const agentId of new Set(written.orders.map((order) => order.agentId))) {
    execute(
      kysely
        .updateTable("agents")
        .set((row) => ({ version: row("version", "+", 1) }))
        .where("id", "=", agentId),
    );
  }
}
