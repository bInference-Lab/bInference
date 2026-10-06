import {
  type CardRecord,
  cardRecordSchema,
  type IntentEventRecord,
  intentEventRecordSchema,
  type IntentRecord,
  intentRecordSchema,
  type StoredConfirmation,
  storedConfirmationSchema,
} from "@binference/engine";
import type { Selectable } from "kysely";
import type {
  CardsTable,
  ConfirmationsTable,
  IntentEventsTable,
  IntentsTable,
} from "../databases/engine-tables.js";
import { field, jsonField, readJson } from "../rows/column-values.js";

/** Reads one `intents` row as its record. */
export function toIntentRecord(row: Selectable<IntentsTable>): IntentRecord {
  return intentRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    walletId: row.wallet_id,
    kind: row.kind,
    state: row.state,
    ...field("reason", row.reason),
    request: readJson(row.request),
    ...jsonField("plan", row.plan),
    ...jsonField("quote", row.quote),
    ...jsonField("risk", row.risk),
    ...jsonField("simulation", row.simulation),
    ...jsonField("authorizedBy", row.authorized_by),
    hasOutsideContent: row.outside_content === 1,
    isPaper: row.paper === 1,
    proposer: row.proposer,
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}

/** Reads one `intent_events` row as its record. */
export function toIntentEvent(row: Selectable<IntentEventsTable>): IntentEventRecord {
  return intentEventRecordSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    ...field("fromState", row.from_state),
    toState: row.to_state,
    cause: readJson(row.cause),
    atMs: row.at,
  });
}

/** Reads one `cards` row as its record. */
export function toCardRecord(row: Selectable<CardsTable>): CardRecord {
  return cardRecordSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    version: row.version,
    termsHash: row.terms_hash,
    ...field("callbackRef", row.callback_ref),
    openedAtMs: row.opened_at,
    expiresAtMs: row.expires_at,
    ...field("closedAtMs", row.closed_at),
    ...field("closeReason", row.close_reason),
  });
}

/** Reads one `confirmations` row as its record. */
export function toConfirmation(row: Selectable<ConfirmationsTable>): StoredConfirmation {
  return storedConfirmationSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    cardId: row.card_id,
    cardVersion: row.card_version,
    termsHash: row.terms_hash,
    bySurface: row.by_surface,
    byRef: row.by_ref,
    atMs: row.at,
    expiresAtMs: row.expires_at,
  });
}
