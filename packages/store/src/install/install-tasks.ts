import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type InstallFacts,
  installFactsSchema,
  type InstallIdProposal,
  installIdProposalSchema,
  type InstallSetup,
  installSetupSchema,
} from "@binference/engine/install";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, jsonText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { hasCustody, readInstall } from "./install-rows.js";

const installIdKey = "install_id";
const createdAtKey = "created_at";

function writeCustody(database: DatabaseSync, setup: InstallSetup): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { custody } = setup;
  const columns = {
    provider: custody.provider,
    app_id: custody.appId,
    owner_quorum_id: custody.ownerQuorumId,
    owner_key_public: custody.ownerKeyPublic,
    agent_quorum_id: custody.agentQuorumId,
    agent_key_public: custody.agentKeyPublic,
    attached_at: custody.attachedAtMs,
  };
  if (hasCustody(database)) {
    execute(
      kysely
        .updateTable("custody")
        .set((row) => ({ ...columns, version: row("version", "+", 1) }))
        .where("id", "=", 1),
    );
  } else {
    execute(kysely.insertInto("custody").values({ id: 1, ...columns, version: 0 }));
  }
}

function writeRescue(database: DatabaseSync, setup: InstallSetup): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("safety")
      .set((row) => ({
        rescue_address: setup.rescueAddress,
        pending_rescue_address: null,
        pending_rescue_at: null,
        version: row("version", "+", 1),
      }))
      .where("id", "=", 1),
  );
}

function writeWallet(database: DatabaseSync, setup: InstallSetup): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { wallet } = setup;
  execute(
    kysely.updateTable("wallets").set({ archived_at: setup.atMs }).where("archived_at", "is", null),
  );
  execute(
    kysely.insertInto("wallets").values({
      id: wallet.id,
      agent_id: wallet.agentId,
      family: wallet.family,
      custody: wallet.custody,
      custody_wallet_id: wallet.custodyWalletId,
      policy_id: wallet.policyId,
      signer_id: wallet.signerId,
      address: wallet.address,
      label: wallet.label,
      created_at: wallet.createdAtMs,
      archived_at: null,
    }),
  );
  execute(
    kysely.insertInto("ceilings").values({
      wallet_id: wallet.id,
      policy_id: wallet.ceiling.policyId,
      policy: jsonText(wallet.ceiling.policy),
      per_tx_native: decimalText(wallet.ceiling.perTxNativeBase),
      read_at: wallet.ceiling.readAtMs,
      version: 0,
    }),
  );
}

/** Answers the install's id, storing the proposed one with its start time when there is none. */
export const installIdTask: StoreTask<InstallIdProposal, Id<"ins">> = defineTask({
  name: "install.id",
  access: "write",
  input: installIdProposalSchema,
  output: idSchema("ins"),
  run(database, proposal) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const held = takeFirst(
      kysely.selectFrom("meta").select("value").where("key", "=", installIdKey),
    );
    if (held !== undefined) {
      return idSchema("ins").parse(held.value);
    }
    execute(
      kysely.insertInto("meta").values([
        { key: installIdKey, value: proposal.id },
        { key: createdAtKey, value: String(proposal.atMs) },
      ]),
    );
    return proposal.id;
  },
});

/** Reads the install's custody, rescue address and wallets. */
export const readInstallTask: StoreTask<null, InstallFacts> = defineTask({
  name: "install.read",
  access: "read",
  input: z.null(),
  output: installFactsSchema,
  run: (database) => readInstall(database),
});

/** Writes a setup in one transaction, or answers `set_up` for an install set up before. */
export const setUpInstallTask: StoreTask<InstallSetup, Result<void, "set_up">> = defineTask({
  name: "install.setUp",
  access: "write",
  input: installSetupSchema,
  output: resultSchema(z.undefined(), ["set_up"]),
  run(database, setup) {
    if (hasCustody(database) && !setup.isStartOver) {
      return err("set_up");
    }
    writeCustody(database, setup);
    writeRescue(database, setup);
    writeWallet(database, setup);
    return ok(undefined);
  },
});
