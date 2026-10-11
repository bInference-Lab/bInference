import type { DatabaseSync } from "node:sqlite";
import type { AccessRows, AgentGuards, GuardsCarry } from "@binference/engine/backups";
import { limitsColumns, pendingColumns } from "../agents/limits-rows.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { type AccessTable, accessRowOf, accessTables } from "./access-rows.schema.js";
import { insertBackup } from "./backup-tasks.js";

const rowsNamed: { readonly [T in AccessTable]: keyof AccessRows } = {
  tokens: "tokens",
  devices: "devices",
  web_push_subscriptions: "webPushSubscriptions",
  pair_codes: "pairCodes",
  mini_app_launches: "miniAppLaunches",
  mini_app_tickets: "miniAppTickets",
};

// Replaces every access table with the carried rows: children go first, then come back last.
function writeAccess(database: DatabaseSync, access: AccessRows): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  for (const table of accessTables.toReversed()) {
    execute(kysely.deleteFrom(table));
  }
  for (const table of accessTables) {
    for (const row of access[rowsNamed[table]]) {
      execute(kysely.insertInto(table).values(accessRowOf(table, row)));
    }
  }
}

function writeSafety(database: DatabaseSync, carry: GuardsCarry): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { safety, telegramOwner } = carry;
  execute(
    kysely
      .updateTable("safety")
      .set((row) => ({
        frozen_at: safety.frozenAtMs ?? null,
        rescue_address: safety.rescueAddress ?? null,
        pending_rescue_address: safety.pendingRescue?.address ?? null,
        pending_rescue_at: safety.pendingRescue?.atMs ?? null,
        rescue_ceiling: safety.rescueCeiling ?? null,
        version: row("version", "+", 1),
      }))
      .where("id", "=", 1),
  );
  execute(kysely.deleteFrom("telegram_owner"));
  if (telegramOwner !== undefined) {
    const { userId, pairedAtMs } = telegramOwner;
    execute(
      kysely.insertInto("telegram_owner").values({ id: 1, user_id: userId, paired_at: pairedAtMs }),
    );
  }
}

// The agent's own row, its approval mode and its send level, each one version on.
function writeAgentRows(database: DatabaseSync, agent: AgentGuards, nowMs: number): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const id = agent.agentId;
  execute(
    kysely
      .updateTable("agents")
      .set((row) => ({
        mode: agent.mode,
        frozen_at: agent.frozenAtMs ?? null,
        archived_at: agent.archivedAtMs ?? null,
        changed_at: nowMs,
        version: row("version", "+", 1),
      }))
      .where("id", "=", id),
  );
  execute(
    kysely
      .updateTable("approval_modes")
      .set((row) => ({
        mode: agent.approvalMode,
        changed_at: nowMs,
        version: row("version", "+", 1),
      }))
      .where("agent_id", "=", id),
  );
  const { level, pending } = agent.sendLevel;
  execute(
    kysely
      .updateTable("send_levels")
      .set((row) => ({
        level,
        pending_level: pending?.level ?? null,
        pending_at: pending?.atMs ?? null,
        changed_at: nowMs,
        version: row("version", "+", 1),
      }))
      .where("agent_id", "=", id),
  );
}

// The agent's limits, one version on, and the address book entries removed since the backup.
function writeAgentLimits(database: DatabaseSync, agent: AgentGuards, nowMs: number): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const id = agent.agentId;
  execute(
    kysely
      .updateTable("limits")
      .set((row) => ({
        ...limitsColumns(agent.limits.values),
        ...pendingColumns(agent.limits.pending),
        changed_at: nowMs,
        version: row("version", "+", 1),
      }))
      .where("agent_id", "=", id),
  );
  for (const entry of agent.removedAddresses) {
    execute(
      kysely
        .updateTable("address_book")
        .set({ removed_at: entry.removedAtMs })
        .where("id", "=", entry.id)
        .where("agent_id", "=", id)
        .where("removed_at", "is", null),
    );
  }
}

function writeOutflows(database: DatabaseSync, carry: GuardsCarry, nowMs: number): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const agents = new Set<string>(carry.agents.map((agent) => agent.agentId));
  for (const outflow of carry.outflows.filter((each) => agents.has(each.agentId))) {
    const row = {
      intent_id: outflow.intentId,
      agent_id: outflow.agentId,
      paper: outflow.isPaper ? 1 : 0,
      confirmed_at: outflow.atMs,
      value_usd_micros: outflow.valueUsdMicros.toString(),
      carried_at: nowMs,
    };
    execute(
      kysely
        .insertInto("carried_outflows")
        .values(row)
        .onConflict((conflict) => conflict.column("intent_id").doUpdateSet(row)),
    );
  }
}

/**
 * Writes a restore's carry into the restored `engine.sqlite`, in the caller's transaction: the
 * access rows and the Telegram owner of the state it replaces, the install's safety, each agent's
 * merged guards, the outflows the cap counts, and the backup records it lacked.
 */
export function writeCarry(database: DatabaseSync, carry: GuardsCarry, nowMs: number): void {
  writeAccess(database, carry.access);
  writeSafety(database, carry);
  for (const agent of carry.agents) {
    writeAgentRows(database, agent, nowMs);
    writeAgentLimits(database, agent, nowMs);
  }
  writeOutflows(database, carry, nowMs);
  for (const backup of carry.backups) {
    insertBackup(database, backup);
  }
}
