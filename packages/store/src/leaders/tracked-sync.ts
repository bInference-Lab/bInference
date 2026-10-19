// Keeps `tracked_wallets` with the writes that start and end a wallet's tracking (decision 0251).
// Every function runs inside the caller's store task, in its transaction.
import type { DatabaseSync } from "node:sqlite";
import { type AccountRef, accountRefSchema } from "@binference/chain";
import { copyLeaderOf, maxTrackedWallets, trackingOrderStates } from "@binference/engine/orders";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { toOrderRecord } from "../orders/order-rows.js";

/**
 * The accounts the install tracks now: those of the active wallet alerts, and the leaders of the
 * copy orders awaiting their card, active or paused, of agents not archived.
 */
export function namedAccounts(database: DatabaseSync): ReadonlySet<AccountRef> {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const inUse = kysely.selectFrom("agents").select("id").where("archived_at", "is", null);
  const alerts = execute(
    kysely
      .selectFrom("alerts")
      .select("account")
      .distinct()
      .where("state", "=", "active")
      .where("account", "is not", null)
      .where("agent_id", "in", inUse),
  ).rows.flatMap(({ account }) => (account === null ? [] : [accountRefSchema.parse(account)]));
  const copies = execute(
    kysely
      .selectFrom("orders")
      .selectAll()
      .where("kind", "=", "copy")
      .where("state", "in", trackingOrderStates)
      .where("agent_id", "in", inUse),
  ).rows.flatMap((row) => copyLeaderOf(toOrderRecord(row).request) ?? []);
  return new Set([...alerts, ...copies]);
}

/**
 * Moves `tracked_wallets` to the accounts named now, at `atMs`: a newly named account is tracked,
 * one tracked again starts a new span with no blocks read, and one no longer named is untracked.
 */
export function syncTrackedWallets(database: DatabaseSync, atMs: number): void {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const named = namedAccounts(database);
  for (const account of named) {
    const row = takeFirst(
      kysely.selectFrom("tracked_wallets").selectAll().where("account", "=", account),
    );
    if (row === undefined) {
      const fresh = {
        account,
        since_block: null,
        last_block: null,
        overflow_blocks: 0,
        added_at: atMs,
        untracked_at: null,
        overflow_told_blocks: 0,
        overflow_told_at: null,
      };
      execute(kysely.insertInto("tracked_wallets").values(fresh));
    } else if (row.untracked_at !== null) {
      const again = { since_block: null, last_block: null, added_at: atMs, untracked_at: null };
      execute(kysely.updateTable("tracked_wallets").set(again).where("account", "=", account));
    }
  }
  const active = execute(
    kysely.selectFrom("tracked_wallets").select("account").where("untracked_at", "is", null),
  ).rows;
  const names: ReadonlySet<string> = named;
  const gone = active.map(({ account }) => account).filter((account) => !names.has(account));
  if (gone.length > 0) {
    execute(
      kysely
        .updateTable("tracked_wallets")
        .set({ untracked_at: atMs })
        .where("account", "in", gone),
    );
  }
}

/**
 * Whether naming `account` keeps the install within its 50 tracked wallets: it is named already,
 * or fewer than 50 are. It reads what names each account now, so a slot an archived agent held is
 * free before any write.
 */
export function hasTrackRoom(database: DatabaseSync, account: AccountRef): boolean {
  const named = namedAccounts(database);
  return named.has(account) || named.size < maxTrackedWallets;
}
