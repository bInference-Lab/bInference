import type { DatabaseSync } from "node:sqlite";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { IntentCommit } from "@binference/engine";
import type { FreezeCommit, FreezeWrite } from "@binference/engine/safety";
import { readAgentFreezes, writeAgentFreezes } from "../agents/agent-freeze-writes.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { appendLedgerEntry } from "../ledger/ledger-rows.js";
import { moveIntent, readMoved } from "./intent-writes.js";

function moved(write: FreezeWrite["moves"][number], database: DatabaseSync): IntentCommit {
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
  database: DatabaseSync,
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
 * Writes a freeze or an unfreeze in the caller's transaction: every intent move and agent row is read first, and
 * an unknown one is `not_found`, one at another version `stale`, before anything is written. Then
 * each move lands with its event, ledger entry and card writes, each agent is marked frozen or
 * unfrozen, the install too when the write covers it, and the write's own entries follow the
 * moves' on the ledger. A card write that would fail throws,
 * which rolls the whole freeze back.
 */
export function writeFreeze(
  database: DatabaseSync,
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
  const moves = write.moves.map((change) => moved(change, database));
  const change = { atMs: write.atMs, isFrozen: write.isFrozen };
  const agents = writeAgentFreezes(database, rows.value, change);
  if (write.isWholeInstall) {
    freezeInstall(database, change);
  }
  const ledgerEntries = write.ledger.map((draft) => appendLedgerEntry(database, draft));
  return ok({ agents, moves, ledgerEntries });
}
