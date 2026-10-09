import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import type { AgentRecord } from "@binference/engine";
import type { AgentFreeze } from "@binference/engine/safety";
import type { Selectable } from "kysely";
import type { AgentsTable, EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { toAgentRecord } from "./agent-rows.js";

/**
 * Reads each agent row a freeze names, in the caller's transaction: an unknown agent is
 * `not_found`, and a row at another version than the freeze read is `stale`.
 */
export function readAgentFreezes(
  database: DatabaseSync,
  freezes: readonly AgentFreeze[],
): Result<readonly Selectable<AgentsTable>[], "not_found" | "stale"> {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const rows: Selectable<AgentsTable>[] = [];
  for (const freeze of freezes) {
    const row = takeFirst(kysely.selectFrom("agents").selectAll().where("id", "=", freeze.agentId));
    if (row === undefined) {
      return err("not_found");
    }
    if (row.version !== freeze.expectedVersion) {
      return err("stale");
    }
    rows.push(row);
  }
  return ok(rows);
}

/**
 * Marks agent rows frozen at `atMs` in the caller's transaction, each under the version it was
 * read at: an agent frozen before keeps its first time, and each row's version rises by one.
 */
export function writeAgentFreezes(
  database: DatabaseSync,
  rows: readonly Selectable<AgentsTable>[],
  atMs: number,
): readonly AgentRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  return rows.map((read) => {
    const row = {
      ...read,
      frozen_at: read.frozen_at ?? atMs,
      changed_at: atMs,
      version: read.version + 1,
    };
    execute(
      kysely
        .updateTable("agents")
        .set(row)
        .where("id", "=", read.id)
        .where("version", "=", read.version),
    );
    return toAgentRecord(row);
  });
}
