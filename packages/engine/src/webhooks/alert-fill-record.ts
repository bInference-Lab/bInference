import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { failureReasons } from "../intents/intent-reason.js";
import { type OrderFillReason, orderFillReasonSchema } from "../orders/order-fill.js";
import { epochMsSchema, pageLimitSchema, rowNumberSchema } from "../records/record-fields.js";
import { type WebhookRuleMove, webhookRuleMoveSchema } from "./webhook-rule-record.js";

/**
 * An accepted alert as its `webhook_events` row keeps it, with what became of its fill
 * (decisions 0336 to 0338): none yet, `filled` with the intent that filled, or `skipped` with its
 * reason and the intent that ended, if one was stored.
 */
export interface AlertFillRecord {
  /** Its `webhook_events` row, which keys its fill. */
  readonly event: number;
  readonly ruleId: Id<"whr">;
  /** The body's `id`, when it had one. */
  readonly alertId?: string;
  readonly receivedAtMs: number;
  /** Whether the engine was locked as it arrived, which skips its fill (decision 0336). */
  readonly wasEngineLocked: boolean;
  readonly outcome?: "filled" | "skipped";
  /** Absent for a fill. */
  readonly reason?: OrderFillReason;
  readonly intentId?: Id<"int">;
  /** What the owner hears of it, each notice as its push carries it, written with the outcome. */
  readonly notices?: readonly JsonValue[];
  /** When the notices were announced; absent until they are. */
  readonly announcedAtMs?: number;
}

/** Parses an accepted alert's row. */
export const alertFillRecordSchema: z.ZodType<AlertFillRecord> = z.strictObject({
  event: rowNumberSchema,
  ruleId: idSchema("whr"),
  alertId: z.string().min(1).max(128).exactOptional(),
  receivedAtMs: epochMsSchema,
  wasEngineLocked: z.boolean(),
  outcome: z.enum(["filled", "skipped"]).exactOptional(),
  reason: orderFillReasonSchema.exactOptional(),
  intentId: idSchema("int").exactOptional(),
  notices: z.array(jsonValueSchema).min(1).exactOptional(),
  announcedAtMs: epochMsSchema.exactOptional(),
});

/**
 * The write that ends an accepted alert's fill: its outcome on its row, with its notices, and the
 * move of its rule that counts a fill or keeps its notice hour. A fill is written with the move of
 * the intent that filled, in the same write (`IntentStore.transition`); a skip alone
 * (`WebhookRuleStore.endAlert`).
 */
export interface AlertFillWrite {
  readonly event: number;
  readonly outcome: "filled" | "skipped";
  /** A skip's reason; a fill has none. */
  readonly reason?: OrderFillReason;
  readonly intentId?: Id<"int">;
  readonly notices?: readonly JsonValue[];
  readonly move?: WebhookRuleMove;
}

// A skip carries its reason; a fill none, and the intent that filled.
function isWellFormed(write: {
  readonly outcome: string;
  readonly reason?: string | undefined;
  readonly intentId?: string | undefined;
}): boolean {
  const isSkip = write.outcome === "skipped";
  return isSkip === (write.reason !== undefined) && (isSkip || write.intentId !== undefined);
}

/** Parses an alert's end. A skip carries a reason, a fill none and its intent. */
export const alertFillWriteSchema: z.ZodType<AlertFillWrite> = z
  .strictObject({
    event: rowNumberSchema,
    outcome: z.enum(["filled", "skipped"]),
    reason: orderFillReasonSchema.exactOptional(),
    intentId: idSchema("int").exactOptional(),
    notices: z.array(jsonValueSchema).min(1).exactOptional(),
    move: webhookRuleMoveSchema.exactOptional(),
  })
  .refine(isWellFormed);

/** A page of one rule's accepted alerts, the newest first. */
export interface AlertFillQuery {
  readonly ruleId: Id<"whr">;
  readonly limit: number;
  /**
   * Only the alerts a live fill of the rule ended: filled, or skipped as the fill failed on chain
   * (decision 0342), so skips before any fill never push failures out of a page.
   */
  readonly onlyFills?: boolean;
}

/** Parses a page of a rule's alerts. */
export const alertFillQuerySchema: z.ZodType<AlertFillQuery> = z.strictObject({
  ruleId: idSchema("whr"),
  limit: pageLimitSchema,
  onlyFills: z.boolean().exactOptional(),
});

/** Whether an alert's end is its fill's: filled, or skipped as the fill failed on chain. */
export function isFillEnd(alert: Pick<AlertFillRecord, "outcome" | "reason">): boolean {
  const failures: readonly string[] = failureReasons;
  return (
    alert.outcome === "filled" || (alert.reason !== undefined && failures.includes(alert.reason))
  );
}

/** The rows whose notices went out at `atMs`. */
export interface AlertAnnouncement {
  readonly events: readonly number[];
  readonly atMs: number;
}

/** Parses an announcement. */
export const alertAnnouncementSchema: z.ZodType<AlertAnnouncement> = z.strictObject({
  events: z.array(rowNumberSchema).min(1).max(1_000),
  atMs: epochMsSchema,
});
