import type { DatabaseSync } from "node:sqlite";
import { type Id, idSchema } from "@binference/core";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";

/** An agent and its wallet that a test planted, for the rows that name them. */
export interface PlantedAgent {
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
}

/** Writes agent `n` and one wallet of it straight into an engine database, for adapter tests. */
export function plantAgent(database: DatabaseSync, n: number): PlantedAgent {
  const suffix = n.toString(16).padStart(12, "0");
  const agentId = idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${suffix}`);
  const walletId = idSchema("wal").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-${suffix}`);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("agents").values({
      id: agentId,
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
  return { agentId, walletId };
}
