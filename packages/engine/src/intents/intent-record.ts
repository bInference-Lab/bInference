import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { intentKindSchema, intentStateSchema } from "@binference/protocol";
import { z } from "zod";
import { type LedgerDraft, ledgerDraftSchema } from "../ledger/ledger-entry.js";
import { epochMsSchema, rowVersionSchema } from "../records/record-fields.js";
import type { IntentKind } from "./intent-kind.js";
import { type IntentReason, intentReasons } from "./intent-reason.js";
import type { IntentState } from "./intent-state.js";

/**
 * Who proposed an intent, as the intents table stores it: the client token or console device that
 * called, `telegram` for the owner on Telegram, or `engine` for an auto order or webhook rule fill.
 */
export type IntentProposerRef = Id<"tok"> | Id<"dev"> | "telegram" | "engine";

/** Parses who proposed an intent. */
export const intentProposerRefSchema: z.ZodType<IntentProposerRef, string> = z.union([
  idSchema("tok"),
  idSchema("dev"),
  z.literal("telegram"),
  z.literal("engine"),
]);

const reasons: ReadonlySet<string> = new Set(intentReasons);

/** Parses a reason code an intent stores with a terminal state. */
export const intentReasonSchema: z.ZodType<IntentReason, string> = z
  .string()
  .refine((code): code is IntentReason => reasons.has(code), {
    message: "Expected an intent reason code.",
  });

/**
 * The parts of an intent that its steps fill in as it moves. Each stays absent until a step sets
 * it; a set part is never cleared. The JSON documents are parsed by the steps that own them.
 */
export interface IntentFields {
  readonly reason?: IntentReason;
  readonly plan?: JsonValue;
  readonly quote?: JsonValue;
  readonly risk?: JsonValue;
  readonly simulation?: JsonValue;
  readonly authorizedBy?: JsonValue;
}

const fieldsShape = {
  reason: intentReasonSchema.exactOptional(),
  plan: jsonValueSchema.exactOptional(),
  quote: jsonValueSchema.exactOptional(),
  risk: jsonValueSchema.exactOptional(),
  simulation: jsonValueSchema.exactOptional(),
  authorizedBy: jsonValueSchema.exactOptional(),
};

/** Parses the parts of an intent its steps fill in. */
export const intentFieldsSchema: z.ZodType<IntentFields> = z.strictObject(fieldsShape);

/** One intent as the store keeps it (database spec, section 2.3). */
export interface IntentRecord extends IntentFields {
  readonly id: Id<"int">;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
  readonly kind: IntentKind;
  readonly state: IntentState;
  /** The request as the proposer sent it. */
  readonly request: JsonValue;
  /** The proposing turn read outside content. */
  readonly hasOutsideContent: boolean;
  /** The intent fills at its quote and never signs. */
  readonly isPaper: boolean;
  readonly proposer: IntentProposerRef;
  readonly createdAtMs: number;
  /** When the intent last moved: the time of its newest event. */
  readonly changedAtMs: number;
  /** 0 when proposed and one more with each move; a move names the version it read. */
  readonly version: number;
}

const identityShape = {
  id: idSchema("int"),
  agentId: idSchema("agt"),
  walletId: idSchema("wal"),
  kind: intentKindSchema,
  state: intentStateSchema,
  ...fieldsShape,
  request: jsonValueSchema,
  hasOutsideContent: z.boolean(),
  isPaper: z.boolean(),
  proposer: intentProposerRefSchema,
};

/** Parses an intent record. */
export const intentRecordSchema: z.ZodType<IntentRecord> = z.strictObject({
  ...identityShape,
  createdAtMs: epochMsSchema,
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/**
 * A new intent, written in one transaction with its first event and, when given, its ledger entry.
 * It starts at version 0, created and changed at `atMs`.
 */
export interface IntentDraft extends Omit<IntentRecord, "createdAtMs" | "changedAtMs" | "version"> {
  readonly atMs: number;
  /** The first event's cause. */
  readonly cause: JsonValue;
  readonly ledger?: LedgerDraft;
}

/** Parses an intent draft. */
export const intentDraftSchema: z.ZodType<IntentDraft> = z.strictObject({
  ...identityShape,
  atMs: epochMsSchema,
  cause: jsonValueSchema,
  ledger: ledgerDraftSchema.exactOptional(),
});
