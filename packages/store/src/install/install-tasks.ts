import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, jsonValueSchema, ok, type Result } from "@binference/core";
import {
  type CeilingUpdate,
  ceilingUpdateSchema,
  type InstallFacts,
  installFactsSchema,
  type InstallIdProposal,
  installIdProposalSchema,
  type InstallSetup,
  installSetupSchema,
  type WalletDraft,
  walletDraftSchema,
  cancelRescue,
  changeRescue,
  type RescueAddressChange,
  rescueAddressChangeSchema,
  type RescueCancel,
  rescueCancelSchema,
  type RescueCeiling,
  rescueCeilingAfter,
  rescueCeilingSchema,
  type RescueMove,
  rescueMoveSchema,
  type RescueState,
  rescueAt,
} from "@binference/engine/install";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, jsonText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { hasCustody, readInstall, readRescue, readRescueCeiling } from "./install-rows.js";

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
        rescue_ceiling: null,
        version: row("version", "+", 1),
      }))
      .where("id", "=", 1),
  );
}

function insertWallet(database: DatabaseSync, wallet: WalletDraft): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
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

function writeWallet(database: DatabaseSync, setup: InstallSetup): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.updateTable("wallets").set({ archived_at: setup.atMs }).where("archived_at", "is", null),
  );
  insertWallet(database, setup.wallet);
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

/** A rule's rescue move at a time, and the ceiling changes a new address that waits comes with. */
interface RescueWrite {
  readonly atMs: number;
  readonly decide: (state: RescueState) => RescueState;
  readonly asked?: RescueCeiling;
}

// Writes the rescue state a rule of the engine decides over the row it read, with the ceiling
// changes `rescueCeilingAfter` keeps; a dropped address comes back with the changes kept for it.
function moveRescue(database: DatabaseSync, { atMs, decide, asked }: RescueWrite): RescueCancel {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const stored = readRescue(database);
  const kept = readRescueCeiling(database);
  const move = { before: rescueAt(stored, atMs), after: decide(stored) };
  const ceiling = rescueCeilingAfter(move, {
    ...(kept === undefined ? {} : { stored: kept }),
    ...(asked === undefined ? {} : { asked }),
  });
  const { after } = move;
  execute(
    kysely
      .updateTable("safety")
      .set((row) => ({
        rescue_address: after.rescueAddress ?? null,
        pending_rescue_address: after.pendingRescue?.address ?? null,
        pending_rescue_at: after.pendingRescue?.atMs ?? null,
        rescue_ceiling: ceiling === undefined ? null : jsonText(jsonValueSchema.parse(ceiling)),
        version: row("version", "+", 1),
      }))
      .where("id", "=", 1),
  );
  const isDropped = move.before.pendingRescue !== undefined && after.pendingRescue === undefined;
  return { ...move, ...(isDropped && kept !== undefined ? { dropped: kept } : {}) };
}

/** Writes a new rescue address as the engine's rule decides it. */
export const changeRescueTask: StoreTask<RescueAddressChange, RescueMove> = defineTask({
  name: "install.change_rescue",
  access: "write",
  input: rescueAddressChangeSchema,
  output: rescueMoveSchema,
  run(database, { address, atMs, ceiling }) {
    const decide = (state: RescueState): RescueState => changeRescue(state, address, atMs);
    const { before, after } = moveRescue(database, {
      atMs,
      decide,
      ...(ceiling === undefined ? {} : { asked: ceiling }),
    });
    return { before, after };
  },
});

/** Drops the new rescue address that waits, as the engine's rule decides it. */
export const cancelRescueChangeTask: StoreTask<number, RescueCancel> = defineTask({
  name: "install.cancel_rescue_change",
  access: "write",
  input: z.int().nonnegative(),
  output: rescueCancelSchema,
  run: (database, atMs) =>
    moveRescue(database, { atMs, decide: (state) => cancelRescue(state, atMs) }),
});

/** Forgets the ceiling changes kept for the new rescue address. */
export const clearRescueCeilingTask: StoreTask<null, null> = defineTask({
  name: "install.clear_rescue_ceiling",
  access: "write",
  input: z.null(),
  output: z.null(),
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.updateTable("safety").set({ rescue_ceiling: null }).where("id", "=", 1));
    return null;
  },
});

/** Replaces the ceiling changes kept for the new rescue address that waits, if one waits. */
export const keepRescueCeilingTask: StoreTask<RescueCeiling, null> = defineTask({
  name: "install.keep_rescue_ceiling",
  access: "write",
  input: rescueCeilingSchema,
  output: z.null(),
  run(database, ceiling) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("safety")
        .set({ rescue_ceiling: jsonText(jsonValueSchema.parse(ceiling)) })
        .where("id", "=", 1)
        .where("pending_rescue_address", "is not", null),
    );
    return null;
  },
});

/** Stores a new live wallet with its ceiling; a held id, Privy id or address rolls it back. */
export const createWalletTask: StoreTask<WalletDraft, null> = defineTask({
  name: "install.create_wallet",
  access: "write",
  input: walletDraftSchema,
  output: z.null(),
  run(database, wallet) {
    insertWallet(database, wallet);
    return null;
  },
});

/**
 * Replaces a live wallet's copy of its ceiling and raises its version; a wallet the store does
 * not hold, or holds archived, is `not_found` and changes nothing.
 */
export const updateCeilingTask: StoreTask<CeilingUpdate, Result<void, "not_found">> = defineTask({
  name: "install.update_ceiling",
  access: "write",
  input: ceilingUpdateSchema,
  output: resultSchema(z.undefined(), ["not_found"]),
  run(database, { wallet, ceiling }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const live = kysely.selectFrom("wallets").select("id").where("archived_at", "is", null);
    const updated = execute(
      kysely
        .updateTable("ceilings")
        .set((eb) => ({
          policy_id: ceiling.policyId,
          policy: jsonText(ceiling.policy),
          per_tx_native: decimalText(ceiling.perTxNativeBase),
          read_at: ceiling.readAtMs,
          version: eb("version", "+", 1),
        }))
        .where("wallet_id", "=", wallet)
        .where("wallet_id", "in", live),
    );
    return updated.numAffectedRows === 1n ? ok(undefined) : err("not_found");
  },
});
