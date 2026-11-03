import { type Id, idSchema } from "@binference/core";
import { type WebhookRuleRequest, webhookRuleRequestSchema } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { type NoticeHour, noticeHourSchema } from "../notices/notice-hour.js";
import { epochMsSchema, pageLimitSchema, rowVersionSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** Where a webhook rule stands: its URL answers only while it is `active`. */
export type WebhookRuleState = "awaiting_confirmation" | "active" | "deleted";

const ruleStateSchema: z.ZodType<WebhookRuleState, string> = z.enum([
  "awaiting_confirmation",
  "active",
  "deleted",
]);

/** The most rules an agent holds active or awaiting their card (decision 0299). */
export const maxWebhookRulesPerAgent = 20;

/**
 * A new webhook rule to store, awaiting its card (database spec, section 2.4; decisions 0299 and
 * 0337): its request with its wallet, expiry and rate filled, the hash of its secret, the
 * `webhookRule` intent that carries its card, and its agent's mode, which every fill runs in.
 */
export interface WebhookRuleDraft {
  readonly id: Id<"whr">;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
  readonly request: WebhookRuleRequest;
  /** The SHA-256 of the secret its URL ends with; the secret itself is never stored. */
  readonly secretHash: Sha256Hex;
  readonly ratePerMinute: number;
  /** Absent: no limit on its fills, until it expires or is deleted. */
  readonly maxFills?: number;
  readonly expiresAtMs: number;
  readonly intentId: Id<"int">;
  readonly isPaper: boolean;
  readonly atMs: number;
}

/** A stored webhook rule, without its secret's hash. */
export interface WebhookRuleRecord extends Omit<WebhookRuleDraft, "secretHash" | "atMs"> {
  readonly state: WebhookRuleState;
  readonly fills: number;
  /** The card version that confirmed it, once it did. */
  readonly cardId?: Id<"crd">;
  readonly lastAlertAtMs?: number;
  /** When its URL last changed: its creation, or its last rotation. */
  readonly urlChangedAtMs: number;
  /**
   * The last alert row its old URL took, at its last rotation; 0 before one. Every alert at or
   * below it came to an old URL, whatever its time (decision 0337).
   */
  readonly oldUrlLastEvent: number;
  /** Its notice hour: what its fills and skips told and held back (decision 0337). */
  readonly noticeHour?: NoticeHour;
  readonly createdAtMs: number;
  readonly changedAtMs: number;
  readonly version: number;
}

const draftShape = {
  id: idSchema("whr"),
  agentId: idSchema("agt"),
  walletId: idSchema("wal"),
  request: webhookRuleRequestSchema,
  ratePerMinute: z.int().min(1).max(60),
  maxFills: z.int().min(1).exactOptional(),
  expiresAtMs: epochMsSchema,
  intentId: idSchema("int"),
  isPaper: z.boolean(),
};

/** Parses a rule draft. */
export const webhookRuleDraftSchema: z.ZodType<WebhookRuleDraft> = z.strictObject({
  ...draftShape,
  secretHash: sha256HexSchema,
  atMs: epochMsSchema,
});

/** Parses a stored rule. */
export const webhookRuleRecordSchema: z.ZodType<WebhookRuleRecord> = z.strictObject({
  ...draftShape,
  state: ruleStateSchema,
  fills: z.int().nonnegative(),
  cardId: idSchema("crd").exactOptional(),
  lastAlertAtMs: epochMsSchema.exactOptional(),
  urlChangedAtMs: epochMsSchema,
  oldUrlLastEvent: z.int().nonnegative(),
  noticeHour: noticeHourSchema.exactOptional(),
  createdAtMs: epochMsSchema,
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/** A rule's request as its `action` column keeps it: amounts and prices as decimal strings. */
export const webhookRuleRequestDocument: DocumentCodec<WebhookRuleRequest> = documentCodec(
  "webhook rule request",
  webhookRuleRequestSchema,
);

/**
 * One change of a rule, written under the version its writer read, the version then rising by
 * one. Only the fields it names change besides its state and time.
 */
export interface WebhookRuleMove {
  readonly id: Id<"whr">;
  readonly expectedVersion: number;
  readonly state: WebhookRuleState;
  readonly atMs: number;
  /** The card version that confirmed it, kept as it moves to `active`. */
  readonly cardId?: Id<"crd">;
  /** A rotation's new secret hash: the old URL answers nothing from this write on. */
  readonly secretHash?: Sha256Hex;
  readonly fills?: number;
  readonly noticeHour?: NoticeHour;
}

/** Parses a rule move. */
export const webhookRuleMoveSchema: z.ZodType<WebhookRuleMove> = z.strictObject({
  id: idSchema("whr"),
  expectedVersion: rowVersionSchema,
  state: ruleStateSchema,
  atMs: epochMsSchema,
  cardId: idSchema("crd").exactOptional(),
  secretHash: sha256HexSchema.exactOptional(),
  fills: z.int().nonnegative().exactOptional(),
  noticeHour: noticeHourSchema.exactOptional(),
});

/**
 * Why a rule's move wrote nothing: no such rule, another write moved it first, a move into
 * `active` whose card intent holds no confirmation of its card, or of a frozen agent's rule.
 */
export type WebhookRuleMoveRefusal = "not_found" | "stale" | "not_confirmed" | "frozen";

/** Why a new rule was not stored: its id is taken, its agent is frozen, or holds 20 rules. */
export type WebhookRuleCreateRefusal = "exists" | "frozen" | "too_many";

/** The rules in some states, the oldest first, then by id, at most `limit`. */
export interface WebhookRuleQuery {
  readonly states: readonly WebhookRuleState[];
  readonly agentId?: Id<"agt">;
  readonly limit: number;
}

/** Parses a rule query. */
export const webhookRuleQuerySchema: z.ZodType<WebhookRuleQuery> = z.strictObject({
  states: z.array(ruleStateSchema).min(1),
  agentId: idSchema("agt").exactOptional(),
  limit: pageLimitSchema,
});
