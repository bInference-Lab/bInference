import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type UnbondingClaim,
  unbondingClaimSchema,
  type UnbondingClose,
  unbondingCloseSchema,
  type UnbondingDraft,
  unbondingDraftSchema,
  type UnbondingQuery,
  unbondingQuerySchema,
  type UnbondingReadyQuery,
  unbondingReadyQuerySchema,
  type UnbondingRecord,
  unbondingRecordSchema,
  type UnbondingTold,
  unbondingToldSchema,
  type UnbondingWalletQuery,
  unbondingWalletQuerySchema,
} from "@binference/engine/sends";
import type { SelectQueryBuilder, Selectable } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StakeUnbondingsTable } from "../databases/unbonding-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, field, orNull } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

type Rows = SelectQueryBuilder<EngineTables, "stake_unbondings", Selectable<StakeUnbondingsTable>>;

function recordOf(row: Selectable<StakeUnbondingsTable>): UnbondingRecord {
  return unbondingRecordSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    walletId: row.wallet_id,
    venue: row.venue,
    ...field("validator", row.validator),
    requestRef: row.request_ref,
    amount: { asset: row.asset, base: row.amount },
    ...field("valueUsdMicros", row.value_usd_micros),
    readyAtMs: row.ready_at,
    isPaper: row.paper === 1,
    ...field("claimIntentId", row.claim_intent_id),
    ...field("claimedAtMs", row.claimed_at),
    ...field("toldReadyAtMs", row.told_ready_at),
    ...field("closedOutsideAtMs", row.closed_outside_at),
  });
}

// The query's rows: one wallet's of one venue and validator, in one mode.
function ofQuery(select: Rows, query: UnbondingQuery): Rows {
  const { validator } = query;
  return select
    .where("wallet_id", "=", query.walletId)
    .where("paper", "=", query.isPaper ? 1 : 0)
    .where("venue", "=", query.venue)
    .where((eb) =>
      validator === undefined ? eb("validator", "is", null) : eb("validator", "=", validator),
    );
}

// The rows no claim took and none closed outside binference: the coin still waiting.
function openOnly(select: Rows): Rows {
  return select.where("claim_intent_id", "is", null).where("closed_outside_at", "is", null);
}

function rowsOf(
  database: StoreConnection,
  narrow: (select: Rows) => Rows,
): readonly UnbondingRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const select = narrow(kysely.selectFrom("stake_unbondings").selectAll());
  return execute(select.orderBy("ready_at").orderBy("id")).rows.map(recordOf);
}

/**
 * Opens an unstake's unbonding unless its intent holds one, which it answers as it is; an intent
 * the database lacks, or a request held under another unstake, breaks a constraint and throws.
 */
export const openUnbondingTask: StoreTask<UnbondingDraft, UnbondingRecord> = defineTask({
  name: "unbondings.open",
  access: "write",
  input: unbondingDraftSchema,
  output: unbondingRecordSchema,
  run(database, draft) {
    const [held] = rowsOf(database, (select) => select.where("intent_id", "=", draft.intentId));
    if (held !== undefined) {
      return held;
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const inserted = execute(
      kysely.insertInto("stake_unbondings").values({
        intent_id: draft.intentId,
        wallet_id: draft.walletId,
        venue: draft.venue,
        validator: orNull(draft.validator),
        request_ref: draft.requestRef,
        asset: draft.amount.asset,
        amount: decimalText(draft.amount.base),
        value_usd_micros:
          draft.valueUsdMicros === undefined ? null : decimalText(draft.valueUsdMicros),
        ready_at: draft.readyAtMs,
        paper: draft.isPaper ? 1 : 0,
      }),
    );
    return { ...draft, id: Number(inserted.insertId) };
  },
});

/** The query's unbondings no claim took, the soonest ready first, then the oldest. */
export const listOpenUnbondingsTask: StoreTask<UnbondingQuery, readonly UnbondingRecord[]> =
  defineTask({
    name: "unbondings.listOpen",
    access: "read",
    input: unbondingQuerySchema,
    output: z.array(unbondingRecordSchema),
    run: (database, query) => rowsOf(database, (select) => openOnly(ofQuery(select, query))),
  });

/** One wallet's unbondings in one mode no claim took, of every venue, the soonest ready first. */
export const openUnbondingsOfTask: StoreTask<UnbondingWalletQuery, readonly UnbondingRecord[]> =
  defineTask({
    name: "unbondings.openOf",
    access: "read",
    input: unbondingWalletQuerySchema,
    output: z.array(unbondingRecordSchema),
    run: (database, query) =>
      rowsOf(database, (select) =>
        openOnly(
          select.where("wallet_id", "=", query.walletId).where("paper", "=", query.isPaper ? 1 : 0),
        ),
      ),
  });

/** The unbondings a claim took, the soonest ready first, then the oldest. */
export const claimedUnbondingsTask: StoreTask<Id<"int">, readonly UnbondingRecord[]> = defineTask({
  name: "unbondings.claimedBy",
  access: "read",
  input: idSchema("int"),
  output: z.array(unbondingRecordSchema),
  run: (database, claimIntentId) =>
    rowsOf(database, (select) => select.where("claim_intent_id", "=", claimIntentId)),
});

/**
 * Marks the claim's named unbondings as taken by it, unless another claim took one, which is
 * `taken` and changes nothing; answers every unbonding the claim holds.
 */
export const claimUnbondingsTask: StoreTask<
  UnbondingClaim,
  Result<readonly UnbondingRecord[], "taken">
> = defineTask({
  name: "unbondings.claim",
  access: "write",
  input: unbondingClaimSchema,
  output: resultSchema(z.array(unbondingRecordSchema), ["taken"]),
  run(database, claim) {
    const { claimIntentId } = claim;
    const named = rowsOf(database, (select) =>
      ofQuery(select, claim).where("request_ref", "in", claim.requestRefs),
    );
    const isTaken = (row: UnbondingRecord) =>
      row.closedOutsideAtMs !== undefined ||
      (row.claimIntentId !== undefined && row.claimIntentId !== claimIntentId);
    if (named.some(isTaken)) {
      return err("taken");
    }
    const open = named.filter((row) => row.claimIntentId === undefined).map((row) => row.id);
    if (open.length > 0) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      execute(
        kysely
          .updateTable("stake_unbondings")
          .set({ claim_intent_id: claimIntentId, claimed_at: claim.atMs })
          .where("id", "in", open),
      );
    }
    return ok(rowsOf(database, (select) => select.where("claim_intent_id", "=", claimIntentId)));
  },
});

/**
 * The unbondings no claim took that are ready at the query's time and the owner was not told of,
 * in any wallet, mode, venue and validator, the soonest ready first, at most the query's limit.
 */
export const untoldReadyUnbondingsTask: StoreTask<UnbondingReadyQuery, readonly UnbondingRecord[]> =
  defineTask({
    name: "unbondings.untoldReady",
    access: "read",
    input: unbondingReadyQuerySchema,
    output: z.array(unbondingRecordSchema),
    run: (database, query) =>
      rowsOf(database, (select) =>
        openOnly(select)
          .where("told_ready_at", "is", null)
          .where("ready_at", "<=", query.nowMs)
          .limit(query.limit),
      ),
  });

/** Marks the unbondings as told ready at the time; one told already keeps its first time. */
export const markToldUnbondingsTask: StoreTask<UnbondingTold, undefined> = defineTask({
  name: "unbondings.markTold",
  access: "write",
  input: unbondingToldSchema,
  output: z.undefined(),
  run(database, told) {
    if (told.ids.length === 0) {
      return undefined;
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("stake_unbondings")
        .set({ told_ready_at: told.atMs })
        .where("id", "in", told.ids)
        .where("told_ready_at", "is", null),
    );
    return undefined;
  },
});

/**
 * Closes an open unbonding as claimed outside binference at the time and answers it; one a claim
 * took or that closed already is `taken`, and nothing changes.
 */
export const closeOutsideUnbondingTask: StoreTask<
  UnbondingClose,
  Result<UnbondingRecord, "taken">
> = defineTask({
  name: "unbondings.closeOutside",
  access: "write",
  input: unbondingCloseSchema,
  output: resultSchema(unbondingRecordSchema, ["taken"]),
  run(database, close) {
    const [open] = rowsOf(database, (select) => openOnly(select.where("id", "=", close.id)));
    if (open === undefined) {
      return err("taken");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("stake_unbondings")
        .set({ closed_outside_at: close.atMs })
        .where("id", "=", close.id),
    );
    return ok({ ...open, closedOutsideAtMs: close.atMs });
  },
});
