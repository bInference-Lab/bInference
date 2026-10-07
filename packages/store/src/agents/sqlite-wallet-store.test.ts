import type { DatabaseSync } from "node:sqlite";
import { walletStoreContract } from "@binference/engine/testing";
import type { WalletRecord } from "@binference/engine/wallets";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteWalletStore } from "./sqlite-wallet-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

// Writes each wallet and, once, its agent, the way setting up an install stores them.
function plantWallets(database: DatabaseSync, wallets: readonly WalletRecord[]): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const agents = [...new Set(wallets.map((wallet) => wallet.agentId))];
  agents.forEach((agentId, n) =>
    execute(
      kysely.insertInto("agents").values({
        id: agentId,
        name: `agent ${String(n)}`,
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
    ),
  );
  wallets.forEach((wallet, n) =>
    execute(
      kysely.insertInto("wallets").values({
        id: wallet.id,
        agent_id: wallet.agentId,
        family: "evm",
        custody: "privy",
        custody_wallet_id: `custody-${String(n)}`,
        policy_id: "policy",
        signer_id: "signer",
        address: `0x${String(n).padStart(40, "0")}`,
        label: wallet.label,
        created_at: wallet.createdAtMs,
        archived_at: wallet.archivedAtMs ?? null,
      }),
    ),
  );
}

describe("sqlite wallet store", () => {
  it.each(
    walletStoreContract({
      create: async (wallets) => {
        const { host, database } = databases.open(engineDatabase);
        plantWallets(database, wallets);
        return Promise.resolve(createSqliteWalletStore(host));
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
