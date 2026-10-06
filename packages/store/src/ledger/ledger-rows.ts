import type { DatabaseSync } from "node:sqlite";
import {
  chainLedgerEntry,
  type LedgerDraft,
  type LedgerEntry,
  ledgerEntrySchema,
  sha256HexSchema,
} from "@binference/engine";
import type { Selectable } from "kysely";
import type { EngineTables, LedgerTable } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, orNull, readJson } from "../rows/column-values.js";

/** Reads one ledger row as its entry. */
export function toLedgerEntry(row: Selectable<LedgerTable>): LedgerEntry {
  return ledgerEntrySchema.parse({
    seq: row.seq,
    id: row.id,
    atMs: row.at,
    ...field("agentId", row.agent_id),
    kind: row.kind,
    ...field("subject", row.subject),
    data: readJson(row.data),
    prevHash: row.prev_hash,
    hash: row.hash,
  });
}

/**
 * Appends a draft at the end of the chain, inside the caller's write transaction: it reads the
 * last entry, gives the draft the next `seq` and both hashes, and inserts it. The ledger's
 * triggers refuse an entry that does not follow the last one.
 */
export function appendLedgerEntry(database: DatabaseSync, draft: LedgerDraft): LedgerEntry {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const last = takeFirst(
    kysely.selectFrom("ledger").select(["seq", "hash"]).orderBy("seq", "desc").limit(1),
  );
  const entry = chainLedgerEntry(
    last === undefined ? undefined : { seq: last.seq, hash: sha256HexSchema.parse(last.hash) },
    draft,
  );
  execute(
    kysely.insertInto("ledger").values({
      seq: entry.seq,
      id: entry.id,
      at: entry.atMs,
      agent_id: orNull(entry.agentId),
      kind: entry.kind,
      subject: orNull(entry.subject),
      data: jsonText(entry.data),
      prev_hash: entry.prevHash,
      hash: entry.hash,
    }),
  );
  return entry;
}
