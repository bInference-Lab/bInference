// The intent state machine's store adapter: the one file that writes intents.state. Every write
// runs inside one store task's transaction, so a move is written whole or not at all.

import { BinferenceError, err, type Id, type JsonValue, ok, type Result } from "@binference/core";
import type {
  IntentChange,
  IntentCommit,
  IntentDraft,
  IntentEventRecord,
  IntentRecord,
  IntentState,
  LedgerDraft,
  LedgerEntry,
} from "@binference/engine";
import type { AlertFillWrite } from "@binference/engine/orders";
import { settleIntent } from "../agent-inbox/agent-inbox-writes.js";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { appendLedgerEntry } from "../ledger/ledger-rows.js";
import { checkOrderFillWrite, insertOrderFill } from "../orders/order-fill-writes.js";
import { writeOrderMoves } from "../orders/order-writes.js";
import { decimalText, jsonText, optionalJsonText, orNull } from "../rows/column-values.js";
import { checkAlertEnd, isRuleDeleted, writeAlertEnd } from "../webhooks/webhook-rule-writes.js";
import { writeCardChanges } from "./card-writes.js";
import { insertIdentity } from "./identity-rows.js";
import { toIntentEvent, toIntentRecord } from "./intent-rows.js";

interface EventDraft {
  readonly intentId: Id<"int">;
  readonly fromState: IntentState | null;
  readonly toState: IntentState;
  readonly cause: JsonValue;
  readonly atMs: number;
}

function readIntent(database: StoreConnection, id: Id<"int">): IntentRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("intents").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toIntentRecord(row);
}

function addEvent(database: StoreConnection, event: EventDraft): IntentEventRecord {
  const { kysely, takeOne } = createSyncKysely<EngineTables>(database);
  const row = {
    intent_id: event.intentId,
    from_state: event.fromState,
    to_state: event.toState,
    cause: jsonText(event.cause),
    at: event.atMs,
  };
  const { id } = takeOne(kysely.insertInto("intent_events").values(row).returning("id"));
  return toIntentEvent({ ...row, id });
}

function appendFor(
  database: StoreConnection,
  draft: LedgerDraft | undefined,
): LedgerEntry | undefined {
  return draft === undefined ? undefined : appendLedgerEntry(database, draft);
}

// The commit of a write, with the settle message it stores when it ends a runtime's intent.
function commitOf(
  database: StoreConnection,
  written: { readonly intent: IntentRecord; readonly event: IntentEventRecord },
  ledgerEntry: LedgerEntry | undefined,
): IntentCommit {
  const { intent, event } = written;
  const settled = settleIntent(database, intent);
  return {
    intent,
    event,
    ...(ledgerEntry === undefined ? {} : { ledgerEntry }),
    ...(settled === undefined ? {} : { settled }),
  };
}

// The columns a move rewrites, from the intent as it is after the move.
function movedColumns(intent: IntentRecord): {
  readonly state: string;
  readonly reason: string | null;
  readonly plan: string | null;
  readonly quote: string | null;
  readonly risk: string | null;
  readonly simulation: string | null;
  readonly authorized_by: string | null;
  readonly value_usd_micros: string | null;
  readonly changed_at: number;
  readonly version: number;
} {
  return {
    state: intent.state,
    reason: orNull(intent.reason),
    plan: optionalJsonText(intent.plan),
    quote: optionalJsonText(intent.quote),
    risk: optionalJsonText(intent.risk),
    simulation: optionalJsonText(intent.simulation),
    authorized_by: optionalJsonText(intent.authorizedBy),
    value_usd_micros:
      intent.valueUsdMicros === undefined ? null : decimalText(intent.valueUsdMicros),
    changed_at: intent.changedAtMs,
    version: intent.version,
  };
}

/** Writes a new intent with its first event and ledger entry; an id in use is `exists`. */
export function createIntent(
  database: StoreConnection,
  draft: IntentDraft,
): Result<IntentCommit, "exists"> {
  if (readIntent(database, draft.id) !== undefined) {
    return err("exists");
  }
  const { atMs, cause, ledger, ...fields } = draft;
  const intent: IntentRecord = { ...fields, createdAtMs: atMs, changedAtMs: atMs, version: 0 };
  const ledgerEntry = appendFor(database, ledger);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("intents").values({
      ...movedColumns(intent),
      id: intent.id,
      agent_id: intent.agentId,
      wallet_id: intent.walletId,
      kind: intent.kind,
      request: jsonText(intent.request),
      outside_content: Number(intent.hasOutsideContent),
      paper: Number(intent.isPaper),
      proposer: intent.proposer,
      draft_ref: intent.draftRef ?? null,
      assets: optionalJsonText(intent.assets),
      created_at: atMs,
    }),
  );
  const event = addEvent(database, {
    intentId: intent.id,
    fromState: null,
    toState: intent.state,
    cause,
    atMs,
  });
  return ok(commitOf(database, { intent, event }, ledgerEntry));
}

/**
 * The intent a move names, read in the caller's transaction: `not_found` when there is none, and
 * `stale` when its stored version is not the one the mover read.
 */
export function readMoved(
  database: StoreConnection,
  change: IntentChange,
): Result<IntentRecord, "not_found" | "stale"> {
  const current = readIntent(database, change.id);
  if (current === undefined) {
    return err("not_found");
  }
  return current.version === change.expectedVersion ? ok(current) : err("stale");
}

/**
 * A webhook rule fill's write on its alert, carried by its intent's move or its late landing
 * (decisions 0338 and 0342): it names that intent, and a fill counts on its rule unless the rule
 * was deleted meanwhile. An alert that ended, but for a late landing over its own drop, or a rule
 * another write moved, is `stale`.
 */
export function checkRuleFill(
  database: StoreConnection,
  fill: {
    readonly alert: AlertFillWrite;
    readonly intent: string;
    readonly isLanding: boolean;
  },
): Result<undefined, "stale"> {
  const { alert, intent, isLanding } = fill;
  const counts =
    alert.outcome === "skipped" || alert.move !== undefined || isRuleDeleted(database, alert.event);
  if (alert.intentId !== intent || !counts) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "A rule fill's write names its own intent and counts a fill on its rule.",
      details: { intent },
    });
  }
  const checked = checkAlertEnd(database, alert, isLanding ? { overDropOf: intent } : {});
  if (!checked.ok && checked.error === "not_found") {
    throw new BinferenceError({
      code: "store.constraint",
      message: "A rule fill names no accepted alert.",
      details: { intent },
    });
  }
  return checked.ok ? ok(undefined) : err("stale");
}

// A fill's order write, checked before anything is written: an alert or rule another write moved,
// or an order at another version or one a move may not take, is the move's `stale`.
function checkFillWrite(
  database: StoreConnection,
  change: IntentChange,
): Result<undefined, "stale"> {
  const { order, alert } = change;
  const ruleFill = { intent: change.id, isLanding: false };
  if (alert !== undefined && !checkRuleFill(database, { alert, ...ruleFill }).ok) {
    return err("stale");
  }
  if (order === undefined) {
    return ok(undefined);
  }
  return checkOrderFillWrite(database, order);
}

/**
 * Moves an intent when its stored version is the one the mover read: its new state and parts,
 * the event, the ledger entry and the card writes, a fill's order moves and row, and a
 * registration's identity, all in the caller's transaction.
 */
export function moveIntent(
  database: StoreConnection,
  change: IntentChange,
): Result<IntentCommit, "not_found" | "stale"> {
  const read = readMoved(database, change);
  const fill = read.ok ? checkFillWrite(database, change) : ok(undefined);
  if (!read.ok || !fill.ok) {
    return read.ok ? err("stale") : read;
  }
  const current = read.value;
  writeCardChanges(database, change);
  const ledgerEntry = appendFor(database, change.ledger);
  const moved: IntentRecord = {
    ...current,
    ...change.fields,
    state: change.state,
    changedAtMs: change.atMs,
    version: current.version + 1,
  };
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("intents")
      .set(movedColumns(moved))
      .where("id", "=", change.id)
      .where("version", "=", change.expectedVersion),
  );
  const event = addEvent(database, {
    intentId: change.id,
    fromState: current.state,
    toState: change.state,
    cause: change.cause,
    atMs: change.atMs,
  });
  const committed = commitOf(database, { intent: moved, event }, ledgerEntry);
  if (change.identity !== undefined) {
    insertIdentity(database, change.identity);
  }
  const { order, alert } = change;
  if (alert !== undefined) {
    writeAlertEnd(database, alert);
  }
  if (order === undefined) {
    return ok(committed);
  }
  const orders = writeOrderMoves(database, order.moves);
  insertOrderFill(database, order.fill);
  return ok({ ...committed, orders });
}
