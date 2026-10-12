import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { intentStateSchema } from "@binference/protocol";
import { z } from "zod";
import { type AgentInboxMessage, agentInboxMessageSchema } from "../chat/agent-inbox-record.js";
import {
  type LedgerDraft,
  ledgerDraftSchema,
  type LedgerEntry,
  ledgerEntrySchema,
} from "../ledger/ledger-entry.js";
import { type OrderFillWrite, orderFillWriteSchema } from "../orders/order-fill.js";
import { type OrderRecord, orderRecordSchema } from "../orders/order-record.js";
import {
  epochMsSchema,
  pageLimitSchema,
  rowNumberSchema,
  rowVersionSchema,
} from "../records/record-fields.js";
import {
  type CardVersionClosing,
  cardVersionClosingSchema,
  type CardOpening,
  cardOpeningSchema,
} from "./card-record.js";
import { type ConfirmationDraft, confirmationDraftSchema } from "./confirmation-record.js";
import {
  type IntentFields,
  intentFieldsSchema,
  type IntentRecord,
  intentRecordSchema,
} from "./intent-record.js";
import type { IntentState } from "./intent-state.js";

/** One move of an intent as `intent_events` keeps it. The first event has no `fromState`. */
export interface IntentEventRecord {
  readonly id: number;
  readonly intentId: Id<"int">;
  readonly fromState?: IntentState;
  readonly toState: IntentState;
  /** What caused the move: the trigger, who acted, the reason. */
  readonly cause: JsonValue;
  readonly atMs: number;
}

/** Parses an intent event record. */
export const intentEventRecordSchema: z.ZodType<IntentEventRecord> = z.strictObject({
  id: rowNumberSchema,
  intentId: idSchema("int"),
  fromState: intentStateSchema.exactOptional(),
  toState: intentStateSchema,
  cause: jsonValueSchema,
  atMs: epochMsSchema,
});

/**
 * One move of an intent, written all or nothing: the new state and fields under the version the
 * mover read, the event, and with it the ledger entry, a card version opened or closed and the
 * confirmation the move records.
 */
export interface IntentChange {
  readonly id: Id<"int">;
  /** The version the mover read; another version means someone moved the intent first. */
  readonly expectedVersion: number;
  readonly state: IntentState;
  readonly atMs: number;
  /** The event's cause. */
  readonly cause: JsonValue;
  /** The parts this move sets; parts left out keep their stored value. */
  readonly fields?: IntentFields;
  readonly ledger?: LedgerDraft;
  readonly openCard?: CardOpening;
  /** Closes an open card version of this intent at `atMs`. */
  readonly closeCard?: CardVersionClosing;
  readonly confirmation?: ConfirmationDraft;
  /**
   * An auto order fill's write on its order, stored with the move (spec 6, section 5): the order's
   * moves under their versions and the fill's row.
   */
  readonly order?: OrderFillWrite;
}

/** Parses an intent change. */
export const intentChangeSchema: z.ZodType<IntentChange> = z.strictObject({
  id: idSchema("int"),
  expectedVersion: rowVersionSchema,
  state: intentStateSchema,
  atMs: epochMsSchema,
  cause: jsonValueSchema,
  fields: intentFieldsSchema.exactOptional(),
  ledger: ledgerDraftSchema.exactOptional(),
  openCard: cardOpeningSchema.exactOptional(),
  closeCard: cardVersionClosingSchema.exactOptional(),
  confirmation: confirmationDraftSchema.exactOptional(),
  order: orderFillWriteSchema.exactOptional(),
});

/**
 * What a create or a move wrote: the intent as it is now, its event and its ledger entry, and the
 * settle message for the agent runtime when the write ended an intent the runtime proposed
 * (runtime spec, section 3.3). An agent that already holds 200 untaken messages gets none.
 */
export interface IntentCommit {
  readonly intent: IntentRecord;
  readonly event: IntentEventRecord;
  readonly ledgerEntry?: LedgerEntry;
  readonly settled?: AgentInboxMessage;
  /** The orders a fill's move wrote, after it, in its write's order. */
  readonly orders?: readonly OrderRecord[];
}

/** Parses what a create or a move wrote. */
export const intentCommitSchema: z.ZodType<IntentCommit> = z.strictObject({
  intent: intentRecordSchema,
  event: intentEventRecordSchema,
  ledgerEntry: ledgerEntrySchema.exactOptional(),
  settled: agentInboxMessageSchema.exactOptional(),
  orders: z.array(orderRecordSchema).exactOptional(),
});

/**
 * Which intents to list: those in any of `states`, the least recently changed first, and after
 * `after` when given, so a caller pages through a long list.
 */
export interface IntentQuery {
  readonly states: readonly IntentState[];
  /** Only this agent's intents; every agent's when absent. */
  readonly agentId?: Id<"agt">;
  /** Only paper intents when true, only live ones when false; both when absent. */
  readonly isPaper?: boolean;
  /** The last intent of the page before. */
  readonly after?: { readonly changedAtMs: number; readonly id: Id<"int"> };
  readonly limit: number;
}

/** Parses an intent query. */
export const intentQuerySchema: z.ZodType<IntentQuery> = z.strictObject({
  states: z.array(intentStateSchema).min(1),
  agentId: idSchema("agt").exactOptional(),
  isPaper: z.boolean().exactOptional(),
  after: z.strictObject({ changedAtMs: epochMsSchema, id: idSchema("int") }).exactOptional(),
  limit: pageLimitSchema,
});
