import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import type { StoreHost } from "../tasks/store-host.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** An agent and its wallet that a test planted, for the rows that name them. */
export interface PlantedAgent {
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
}

function suffixOf(n: number): string {
  return n.toString(16).padStart(12, "0");
}

function agentIdOf(n: number): Id<"agt"> {
  return idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${suffixOf(n)}`);
}

/**
 * Writes one wallet of agent `n`, which the database already holds, with its ceiling, straight
 * into an engine database, for adapter tests.
 */
function plantWallet(database: StoreConnection, n: number): PlantedAgent {
  const suffix = suffixOf(n);
  const agentId = agentIdOf(n);
  const walletId = idSchema("wal").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-${suffix}`);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("wallets").values({
      id: walletId,
      agent_id: agentId,
      family: "evm",
      custody: "privy",
      custody_wallet_id: `custody-${suffix}`,
      policy_id: "policy",
      signer_id: "signer",
      address: `0x${suffix.padStart(40, "0")}`,
      label: "main",
      created_at: 1,
      archived_at: null,
    }),
  );
  execute(
    kysely.insertInto("ceilings").values({
      wallet_id: walletId,
      policy_id: "policy",
      policy: "{}",
      per_tx_native: "0",
      read_at: 1,
      version: 0,
    }),
  );
  return { agentId, walletId };
}

/**
 * Writes agent `n` and one wallet of it with its ceiling straight into an engine database, for
 * adapter tests.
 */
export function plantAgent(database: StoreConnection, n: number): PlantedAgent {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("agents").values({
      id: agentIdOf(n),
      name: `planted ${String(n)}`,
      mode: "paper",
      locale: "en",
      models: "{}",
      notifications: "{}",
      frozen_at: null,
      archived_at: null,
      created_at: 1,
      changed_at: 1,
      version: 0,
    }),
  );
  return plantWallet(database, n);
}

const plantedSchema = z.strictObject({ agentId: idSchema("agt"), walletId: idSchema("wal") });

/**
 * {@link plantAgent} as a write task, so a test plants on either database through its host. The
 * Postgres test stores' engine worker lists it.
 */
export const plantAgentTask: StoreTask<number, PlantedAgent> = defineTask({
  name: "testing.plant_agent",
  access: "write",
  input: z.number().int().positive(),
  output: plantedSchema,
  run: plantAgent,
});

/** {@link plantWallet} as a write task, listed beside {@link plantAgentTask}. */
export const plantWalletTask: StoreTask<number, PlantedAgent> = defineTask({
  name: "testing.plant_wallet",
  access: "write",
  input: z.number().int().positive(),
  output: plantedSchema,
  run: plantWallet,
});

/** Plants agent `n` through `host`, on SQLite or Postgres alike. */
export async function plantAgentOn(host: StoreHost, n: number): Promise<PlantedAgent> {
  return host.run(plantAgentTask, n, { signal: AbortSignal.timeout(30_000) });
}

/** Plants a wallet of agent `n`, which the agent store created, through `host`. */
export async function plantWalletOn(host: StoreHost, n: number): Promise<PlantedAgent> {
  return host.run(plantWalletTask, n, { signal: AbortSignal.timeout(30_000) });
}
