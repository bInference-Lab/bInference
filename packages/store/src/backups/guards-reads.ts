import type { DatabaseSync } from "node:sqlite";
import { idSchema } from "@binference/core";
import {
  type AccessRows,
  type AgentGuards,
  agentGuardsOf,
  type CountedOutflow,
  type InstallGuards,
  installGuardsSchema,
  type SafetyGuards,
  type WalletFacts,
} from "@binference/engine/backups";
import { isCounted } from "@binference/engine/outflows";
import type { Selectable } from "kysely";
import { readSettings } from "../agents/agent-rows.js";
import type { EngineTables, WalletsTable } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { confirmedSince } from "../intents/confirmed-tasks.js";
import { field } from "../rows/column-values.js";
import type { AccessTable } from "./access-rows.schema.js";
import { listBackups } from "./backup-tasks.js";

// The rolling 24-hour cap's window; an outflow exactly that old still counts.
const windowMs = 86_400_000;
const agentId = idSchema("agt");
const walletId = idSchema("wal");

function accessOf(database: DatabaseSync): AccessRows {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const rows = (table: AccessTable) => execute(kysely.selectFrom(table).selectAll()).rows;
  return {
    tokens: rows("tokens"),
    devices: rows("devices"),
    webPushSubscriptions: rows("web_push_subscriptions"),
    pairCodes: rows("pair_codes"),
    miniAppLaunches: rows("mini_app_launches"),
    miniAppTickets: rows("mini_app_tickets"),
  };
}

function agentsOf(database: DatabaseSync): readonly AgentGuards[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const ids = execute(kysely.selectFrom("agents").select("id").orderBy("id")).rows;
  const removed = execute(
    kysely
      .selectFrom("address_book")
      .select(["id", "agent_id", "removed_at"])
      .where("removed_at", "is not", null),
  ).rows;
  return ids.flatMap(({ id }) => {
    const settings = readSettings(database, agentId.parse(id));
    const entries = removed.flatMap((entry) =>
      entry.agent_id === id && entry.removed_at !== null
        ? [{ id: entry.id, removedAtMs: entry.removed_at }]
        : [],
    );
    return settings === undefined ? [] : [agentGuardsOf(settings, entries)];
  });
}

function outflowsOf(
  database: DatabaseSync,
  agents: readonly AgentGuards[],
  nowMs: number,
): readonly CountedOutflow[] {
  return agents.flatMap((agent) =>
    [true, false].flatMap((isPaper) =>
      confirmedSince(database, { agentId: agent.agentId, isPaper, fromMs: nowMs - windowMs })
        .filter(isCounted)
        .map((intent) => ({
          intentId: intent.intentId,
          agentId: agent.agentId,
          isPaper,
          atMs: intent.confirmedAtMs,
          valueUsdMicros: intent.valueUsdMicros,
        })),
    ),
  );
}

function safetyOf(database: DatabaseSync): SafetyGuards {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("safety").selectAll().where("id", "=", 1));
  if (row === undefined) {
    return {};
  }
  const address = row.pending_rescue_address;
  const atMs = row.pending_rescue_at;
  return {
    ...field("frozenAtMs", row.frozen_at),
    ...field("rescueAddress", row.rescue_address),
    ...(address === null || atMs === null ? {} : { pendingRescue: { address, atMs } }),
    ...field("rescueCeiling", row.rescue_ceiling),
  };
}

function walletOf(
  row: Pick<Selectable<WalletsTable>, "id" | "agent_id" | "address" | "label" | "archived_at">,
): WalletFacts {
  return {
    id: walletId.parse(row.id),
    agentId: agentId.parse(row.agent_id),
    address: row.address,
    label: row.label,
    ...field("archivedAtMs", row.archived_at),
  };
}

/** Reads what a restore must never loosen, and what it shows, from one `engine.sqlite`. */
export function readGuards(database: DatabaseSync, nowMs: number): InstallGuards {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const owner = takeFirst(kysely.selectFrom("telegram_owner").selectAll().where("id", "=", 1));
  const agents = agentsOf(database);
  const wallets = execute(
    kysely.selectFrom("wallets").select(["id", "agent_id", "address", "label", "archived_at"]),
  ).rows;
  const last = takeFirst(
    kysely.selectFrom("intents").select(({ fn }) => fn.max("changed_at").as("at")),
  );
  return installGuardsSchema.parse({
    access: accessOf(database),
    ...(owner === undefined
      ? {}
      : { telegramOwner: { userId: owner.user_id, pairedAtMs: owner.paired_at } }),
    safety: safetyOf(database),
    agents,
    wallets: wallets.map(walletOf),
    outflows: outflowsOf(database, agents, nowMs),
    backups: listBackups(database),
    ...field("lastActivityAtMs", last?.at ?? null),
  });
}
