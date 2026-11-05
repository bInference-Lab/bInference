import { isTxHash, type TxHash } from "@binference/chain";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type BridgeDraft,
  bridgeDraftSchema,
  type BridgeMove,
  type BridgeMoveRefusal,
  bridgeMoveSchema,
  type BridgeQuery,
  bridgeQuerySchema,
  type BridgeRecord,
  bridgeRecordSchema,
  movedBridge,
} from "@binference/engine/sends";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { BridgesTable } from "../databases/bridge-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, field, orNull } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

function recordOf(row: Selectable<BridgesTable>): BridgeRecord {
  return bridgeRecordSchema.parse({
    intentId: row.intent_id,
    venue: row.venue,
    depositTx: row.deposit_ref,
    toChain: row.to_chain,
    recipient: row.recipient,
    sent: { asset: row.sent_asset, base: row.sent_amount },
    minOut: { asset: row.delivered_asset, base: row.min_out },
    ...field("deliveredAsCoin", row.delivered_coin),
    ...field("valueUsdMicros", row.value_usd_micros),
    ...field("statusUrl", row.status_url),
    sentAtMs: row.sent_at,
    state: row.state,
    ...field("lateAtMs", row.late_at),
    ...field("fillTx", row.fill_tx),
    ...field("refundTx", row.refund_tx),
    ...(row.received === null || row.received_asset === null
      ? {}
      : { received: { asset: row.received_asset, base: row.received } }),
    ...field("settledAtMs", row.settled_at),
    ...field("checkedAtMs", row.checked_at),
    version: row.version,
  });
}

function stored(database: StoreConnection, intentId: Id<"int">): BridgeRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("bridges").selectAll().where("intent_id", "=", intentId));
  return row === undefined ? undefined : recordOf(row);
}

/**
 * Opens a bridge in `in_transit` unless its intent has one, which it answers as it is; an intent
 * the database lacks breaks the foreign key and throws.
 */
export const openBridgeTask: StoreTask<BridgeDraft, BridgeRecord> = defineTask({
  name: "bridges.open",
  access: "write",
  input: bridgeDraftSchema,
  output: bridgeRecordSchema,
  run(database, draft) {
    const held = stored(database, draft.intentId);
    if (held !== undefined) {
      return held;
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely.insertInto("bridges").values({
        intent_id: draft.intentId,
        venue: draft.venue,
        deposit_ref: draft.depositTx,
        to_chain: draft.toChain,
        recipient: draft.recipient,
        sent_asset: draft.sent.asset,
        sent_amount: decimalText(draft.sent.base),
        delivered_asset: draft.minOut.asset,
        delivered_coin: orNull(draft.deliveredAsCoin),
        min_out: decimalText(draft.minOut.base),
        value_usd_micros:
          draft.valueUsdMicros === undefined ? null : decimalText(draft.valueUsdMicros),
        state: "in_transit",
        status_url: orNull(draft.statusUrl),
        sent_at: draft.sentAtMs,
        version: 0,
      }),
    );
    return { ...draft, state: "in_transit", version: 0 };
  },
});

/** One intent's bridge, if it has one. */
export const getBridgeTask: StoreTask<Id<"int">, BridgeRecord | undefined> = defineTask({
  name: "bridges.get",
  access: "read",
  input: idSchema("int"),
  output: bridgeRecordSchema.optional(),
  run: (database, intentId) => stored(database, intentId),
});

/** The bridges in the query's states, the oldest deposit first, then by intent. */
export const listBridgesTask: StoreTask<BridgeQuery, readonly BridgeRecord[]> = defineTask({
  name: "bridges.list",
  access: "read",
  input: bridgeQuerySchema,
  output: z.array(bridgeRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { after } = query;
    const rows = execute(
      kysely
        .selectFrom("bridges")
        .selectAll()
        .where("state", "in", query.states)
        .$if(after !== undefined, (select) =>
          select.where((eb) =>
            eb.or([
              eb("sent_at", ">", after?.sentAtMs ?? 0),
              eb.and([
                eb("sent_at", "=", after?.sentAtMs ?? 0),
                eb("intent_id", ">", after?.intentId ?? ""),
              ]),
            ]),
          ),
        )
        .orderBy("sent_at")
        .orderBy("intent_id")
        .limit(query.limit),
    ).rows;
    return rows.map(recordOf);
  },
});

const txHashSchema: z.ZodType<TxHash> = z.custom<TxHash>(
  (value) => typeof value === "string" && isTxHash(value),
);

/** The bridge whose fill or refund is the transaction, if one holds it. */
export const settledByTask: StoreTask<TxHash, BridgeRecord | undefined> = defineTask({
  name: "bridges.settledBy",
  access: "read",
  input: txHashSchema,
  output: bridgeRecordSchema.optional(),
  run(database, tx) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("bridges")
        .selectAll()
        .where((eb) => eb.or([eb("fill_tx", "=", tx), eb("refund_tx", "=", tx)])),
    );
    return row === undefined ? undefined : recordOf(row);
  },
});

// Whether another bridge holds the settlement the move writes: a fill to the same chain, or a
// refund. The unique indexes refuse it too.
function isTaken(database: StoreConnection, moved: BridgeRecord): boolean {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const { fillTx, refundTx } = moved;
  const holder = takeFirst(
    kysely
      .selectFrom("bridges")
      .select("intent_id")
      .where("intent_id", "!=", moved.intentId)
      .where((eb) =>
        eb.or([
          eb.and([eb("to_chain", "=", moved.toChain), eb("fill_tx", "=", fillTx ?? null)]),
          eb("refund_tx", "=", refundTx ?? null),
        ]),
      ),
  );
  return holder !== undefined;
}

/**
 * Moves a bridge under the version the mover read, by the rule both stores share; a settlement
 * another bridge holds is `taken`.
 */
export const moveBridgeTask: StoreTask<
  BridgeMove,
  Result<BridgeRecord, BridgeMoveRefusal>
> = defineTask({
  name: "bridges.move",
  access: "write",
  input: bridgeMoveSchema,
  output: resultSchema(bridgeRecordSchema, ["stale", "taken"]),
  run(database, move) {
    const held = stored(database, move.intentId);
    const moved = held === undefined ? undefined : movedBridge(held, move);
    if (moved === undefined) {
      return err("stale");
    }
    if (isTaken(database, moved)) {
      return err("taken");
    }
    write(database, move, moved);
    return ok(moved);
  },
});

function write(database: StoreConnection, move: BridgeMove, moved: BridgeRecord): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("bridges")
      .set({
        state: moved.state,
        late_at: orNull(moved.lateAtMs),
        fill_tx: orNull(moved.fillTx),
        refund_tx: orNull(moved.refundTx),
        received: moved.received === undefined ? null : decimalText(moved.received.base),
        received_asset: orNull(moved.received?.asset),
        settled_at: orNull(moved.settledAtMs),
        checked_at: orNull(moved.checkedAtMs),
        version: moved.version,
      })
      .where("intent_id", "=", move.intentId)
      .where("version", "=", move.expectedVersion),
  );
}
