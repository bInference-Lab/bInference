import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { IntentCommit } from "@binference/engine";
import type { FreezeCommit, FreezeWrite } from "@binference/engine/safety";
import { readAgentFreezes, writeAgentFreezes } from "../agents/agent-freeze-writes.js";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { appendLedgerEntry } from "../ledger/ledger-rows.js";
import { checkOrderMoves, writeOrderMoves } from "../orders/order-writes.js";
import { breakerStale, bumpAgents, markBreaker } from "./breaker-writes.js";
import { moveIntent, readMoved } from "./intent-writes.js";

function moved(write: FreezeWrite["moves"][number], database: StoreConnection): IntentCommit {
  const commit = moveIntent(database, write);
  if (!commit.ok) {
    throw new BinferenceError({
      code: "store.constraint",
      message: `Intent ${write.id} changed inside the freeze that read it.`,
      details: { intent: write.id },
    });
  }
  return commit.value;
}

// Marks the install frozen at `atMs`, keeping the time of an earlier freeze, or clears its freeze.
function freezeInstall(
  database: StoreConnection,
  change: { readonly atMs: number; readonly isFrozen: boolean },
): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("safety")
      .set((row) => ({
        frozen_at: change.isFrozen ? row.fn.coalesce("frozen_at", row.val(change.atMs)) : null,
        version: row("version", "+", 1),
      }))
      .where("id", "=", 1),
  );
}

/**
 * Writes a freeze or an unfreeze in the caller's transaction: every intent move, agent row and
 * order move is read first, and an unknown one is `not_found`, one at another version `stale`,
 * before anything is written; an order move the order rules refuse is `stale` too. Then each move
 * lands with its event, ledger entry and card writes, each agent is marked frozen or unfrozen, the
 * install too when the write covers it, each order moves, and the write's own entries follow the
 * moves' on the ledger. A card write that would fail throws, which rolls the whole freeze back.
 */
export function writeFreeze(
  database: StoreConnection,
  write: FreezeWrite,
): Result<FreezeCommit, "not_found" | "stale"> {
  for (const change of write.moves) {
    const read = readMoved(database, change);
    if (!read.ok) {
      return err(read.error);
    }
  }
  const rows = readAgentFreezes(database, write.agents);
  if (!rows.ok) {
    return rows;
  }
  if (breakerStale(database, write.breaker)) {
    return err("stale");
  }
  // An unfreeze lifts its agents, and the breaker's lift its hold, before orders move back to
  // `active`.
  const agentsLifted = new Set(write.isFrozen ? [] : write.agents.map(({ agentId }) => agentId));
  const isBreakerLifted = write.breaker?.isPulled === false;
  const lifted = { agents: agentsLifted, isBreakerLifted };
  const orderMoves = checkOrderMoves(database, write.orders, lifted);
  if (!orderMoves.ok) {
    return err(orderMoves.error === "not_found" ? "not_found" : "stale");
  }
  const moves = write.moves.map((change) => moved(change, database));
  markBreaker(database, write);
  const change = { atMs: write.atMs, isFrozen: write.isFrozen };
  const agents = writeAgentFreezes(database, rows.value, change);
  if (write.isWholeInstall) {
    freezeInstall(database, change);
  }
  const orders = writeOrderMoves(database, orderMoves.value);
  bumpAgents(database, { write, orders });
  const ledgerEntries = write.ledger.map((draft) => appendLedgerEntry(database, draft));
  return ok({ agents, moves, orders, ledgerEntries });
}
