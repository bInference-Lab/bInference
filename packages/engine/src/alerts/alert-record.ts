import { type AssetRef, assetRefSchema } from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import {
  type AlertCondition,
  alertConditionSchema,
  type AlertState,
  alertStates,
} from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { epochMsSchema, pageLimitSchema, shortTextSchema } from "../records/record-fields.js";
import { type AlertNoticeWindow, alertNoticeWindowSchema } from "./alert-notice-window.js";

/** The most active alerts one agent holds; one more is `alert.too_many` (protocol spec, 8.4). */
export const maxActiveAlerts = 50;

/**
 * The most wallets one install tracks for wallet alerts and copy orders; one more is
 * `wallet.track_limit` (database spec, section 2.6).
 */
export const maxTrackedWallets = 50;

/** One alert as the store keeps it (database spec, `alerts`). */
export interface AlertRecord {
  readonly id: Id<"alr">;
  readonly agentId: Id<"agt">;
  readonly condition: AlertCondition;
  readonly state: AlertState;
  /** Whether a fire starts a turn of the agent. */
  readonly wake: boolean;
  /** How many times it fired. */
  readonly fires: number;
  /** Set in a turn that held outside content, or by an outside client. */
  readonly outsideContent: boolean;
  /** The credential or surface that set it: a client token's id, or `telegram`. */
  readonly createdBy: string;
  readonly createdAtMs: number;
  readonly changedAtMs: number;
  /** The last fire. */
  readonly firedAtMs?: number;
  /** When it ends, if ever. */
  readonly expiresAtMs?: number;
  /** The wake-up its last fire stored, so a newer fire replaces it while it waits. */
  readonly lastMessageId?: Id<"msg">;
  /** Its notice hour, once it fired: at most five notices an hour (decision 0245). */
  readonly noticeWindow?: AlertNoticeWindow;
}

/** Parses an alert as a store keeps it. */
export const alertRecordSchema: z.ZodType<AlertRecord> = z.strictObject({
  id: idSchema("alr"),
  agentId: idSchema("agt"),
  condition: alertConditionSchema,
  state: z.enum(alertStates),
  wake: z.boolean(),
  fires: z.int().nonnegative(),
  outsideContent: z.boolean(),
  createdBy: shortTextSchema,
  createdAtMs: epochMsSchema,
  changedAtMs: epochMsSchema,
  firedAtMs: epochMsSchema.exactOptional(),
  expiresAtMs: epochMsSchema.exactOptional(),
  lastMessageId: idSchema("msg").exactOptional(),
  noticeWindow: alertNoticeWindowSchema.exactOptional(),
});

/** An alert's condition as JSON keeps it: prices and dollar values as decimal strings. */
export const alertConditionDocument: DocumentCodec<AlertCondition> = documentCodec(
  "alert condition",
  alertConditionSchema,
);

/** The kind of what an alert watches. */
export type AlertKind = AlertCondition["kind"];

/**
 * Which alerts to list: in `states`, of one agent or every agent, of one kind or any, of price
 * alerts on one asset or any, the oldest first, then by id, after `after` when given.
 */
export interface AlertQuery {
  readonly states: readonly AlertState[];
  readonly agentId?: Id<"agt">;
  readonly kind?: AlertKind;
  readonly asset?: AssetRef;
  readonly after?: { readonly createdAtMs: number; readonly id: Id<"alr"> };
  readonly limit: number;
}

/** Parses an alert query. */
export const alertQuerySchema: z.ZodType<AlertQuery> = z.strictObject({
  states: z.array(z.enum(alertStates)).min(1),
  agentId: idSchema("agt").exactOptional(),
  kind: z.enum(["price", "wallet", "launch"]).exactOptional(),
  asset: assetRefSchema.exactOptional(),
  after: z.strictObject({ createdAtMs: epochMsSchema, id: idSchema("alr") }).exactOptional(),
  limit: pageLimitSchema,
});

/** A delete of an active alert, at a time. */
export interface AlertDelete {
  readonly id: Id<"alr">;
  readonly atMs: number;
}

/** Parses a delete. */
export const alertDeleteSchema: z.ZodType<AlertDelete> = z.strictObject({
  id: idSchema("alr"),
  atMs: epochMsSchema,
});

/** The active alerts whose expiry came by `atMs`, the earliest first, at most `limit`. */
export interface AlertExpiry {
  readonly atMs: number;
  readonly limit: number;
}

/** Parses an expiry. */
export const alertExpirySchema: z.ZodType<AlertExpiry> = z.strictObject({
  atMs: epochMsSchema,
  limit: pageLimitSchema,
});

/** An alert whose notice hour ended with matches held back, and how many. */
export interface AlertHeld {
  readonly alert: AlertRecord;
  readonly held: number;
}

/** Parses a held-back count. */
export const alertHeldSchema: z.ZodType<AlertHeld> = z.strictObject({
  alert: alertRecordSchema,
  held: z.int().positive(),
});

/** The asset a price alert watches, which the store keeps beside its condition for its queries. */
export function watchedAssetOf(condition: AlertCondition): AssetRef | undefined {
  return condition.kind === "price" ? condition.asset : undefined;
}
