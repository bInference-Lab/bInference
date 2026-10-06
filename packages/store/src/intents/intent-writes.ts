// The intent state machine's store adapter: the one file that writes intents.state. Every write
// runs inside one store task's transaction, so a move is written whole or not at all.
import type { DatabaseSync } from "node:sqlite";
import { err, type Id, type JsonValue, ok, type Result } from "@binference/core";
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
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { appendLedgerEntry } from "../ledger/ledger-rows.js";
import { jsonText, optionalJsonText, orNull } from "../rows/column-values.js";
import { writeCardChanges } from "./card-writes.js";
import { toIntentEvent, toIntentRecord } from "./intent-rows.js";

interface EventDraft {
  readonly intentId: Id<"int">;
  readonly fromState: IntentState | null;
  readonly toState: IntentState;
  readonly cause: JsonValue;
  readonly atMs: number;
}

function readIntent(database: DatabaseSync, id: Id<"int">): IntentRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("intents").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toIntentRecord(row);
}

function addEvent(database: DatabaseSync, event: EventDraft): IntentEventRecord {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const row = {
    intent_id: event.intentId,
    from_state: event.fromState,
    to_state: event.toState,
    cause: jsonText(event.cause),
    at: event.atMs,
  };
  const inserted = execute(kysely.insertInto("intent_events").values(row));
  return toIntentEvent({ ...row, id: Number(inserted.insertId) });
}

function appendFor(
  database: DatabaseSync,
  draft: LedgerDraft | undefined,
): LedgerEntry | undefined {
  return draft === undefined ? undefined : appendLedgerEntry(database, draft);
}

function commitOf(
  intent: IntentRecord,
  event: IntentEventRecord,
  ledgerEntry: LedgerEntry | undefined,
): IntentCommit {
  return { intent, event, ...(ledgerEntry === undefined ? {} : { ledgerEntry }) };
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
    changed_at: intent.changedAtMs,
    version: intent.version,
  };
}

/** Writes a new intent with its first event and ledger entry; an id in use is `exists`. */
export function createIntent(
  database: DatabaseSync,
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
  return ok(commitOf(intent, event, ledgerEntry));
}

/**
 * Moves an intent when its stored version is the one the mover read: its new state and parts,
 * the event, the ledger entry and the card writes, all in the caller's transaction.
 */
export function moveIntent(
  database: DatabaseSync,
  change: IntentChange,
): Result<IntentCommit, "not_found" | "stale"> {
  const current = readIntent(database, change.id);
  if (current === undefined) {
    return err("not_found");
  }
  if (current.version !== change.expectedVersion) {
    return err("stale");
  }
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
  return ok(commitOf(moved, event, ledgerEntry));
}
