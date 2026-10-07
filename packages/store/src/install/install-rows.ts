import type { DatabaseSync } from "node:sqlite";
import { accountRefSchema } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import {
  type CustodyRecord,
  custodyRecordSchema,
  type InstallFacts,
  type WalletRecord,
  walletRecordSchema,
} from "@binference/engine/install";
import type {
  CeilingsTable,
  CustodyTable,
  EngineTables,
  WalletsTable,
} from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, readDecimal, readJson } from "../rows/column-values.js";

function toCustody(row: CustodyTable): CustodyRecord {
  return custodyRecordSchema.parse({
    provider: row.provider,
    appId: row.app_id,
    ownerQuorumId: row.owner_quorum_id,
    ownerKeyPublic: row.owner_key_public,
    agentQuorumId: row.agent_quorum_id,
    agentKeyPublic: row.agent_key_public,
    attachedAtMs: row.attached_at,
  });
}

function toWallet(row: WalletsTable, ceiling: CeilingsTable): WalletRecord {
  return walletRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    family: row.family,
    custody: row.custody,
    custodyWalletId: row.custody_wallet_id,
    policyId: row.policy_id,
    signerId: row.signer_id,
    address: row.address,
    label: row.label,
    createdAtMs: row.created_at,
    ...field("archivedAtMs", row.archived_at),
    ceiling: {
      policyId: ceiling.policy_id,
      policy: readJson(ceiling.policy),
      perTxNativeBase: readDecimal(ceiling.per_tx_native),
      readAtMs: ceiling.read_at,
    },
  });
}

function readWallets(database: DatabaseSync): readonly WalletRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const wallets = execute(
    kysely.selectFrom("wallets").selectAll().orderBy("created_at").orderBy("id"),
  ).rows;
  const ceilings = execute(kysely.selectFrom("ceilings").selectAll()).rows;
  return wallets.map((wallet) => {
    const ceiling = ceilings.find((item) => item.wallet_id === wallet.id);
    if (ceiling === undefined) {
      throw new BinferenceError({
        code: "store.ceiling_missing",
        message: `Wallet ${wallet.id} has no ceiling row; restore engine.sqlite from a backup.`,
        details: { wallet: wallet.id },
      });
    }
    return toWallet(wallet, ceiling);
  });
}

/** Whether the install holds a custody row: it was set up. */
export function hasCustody(database: DatabaseSync): boolean {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(kysely.selectFrom("custody").select("id").where("id", "=", 1)) !== undefined;
}

/** Reads the install's custody, rescue address and wallets with their ceilings, oldest first. */
export function readInstall(database: DatabaseSync): InstallFacts {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const custody = takeFirst(kysely.selectFrom("custody").selectAll().where("id", "=", 1));
  const safety = takeFirst(
    kysely.selectFrom("safety").select("rescue_address").where("id", "=", 1),
  );
  const rescue = safety?.rescue_address ?? null;
  return {
    ...(custody === undefined ? {} : { custody: toCustody(custody) }),
    ...(rescue === null ? {} : { rescueAddress: accountRefSchema.parse(rescue) }),
    wallets: readWallets(database),
  };
}
