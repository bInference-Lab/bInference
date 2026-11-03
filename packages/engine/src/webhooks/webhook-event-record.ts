import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { type OrderFillReason, orderFillReasonSchema } from "../orders/order-fill.js";
import { epochMsSchema, pageLimitSchema, rowNumberSchema } from "../records/record-fields.js";

/**
 * One alert a rule's URL took, as its `webhook_events` row keeps it, for the owner's list of
 * them (protocol spec, section 7.5): taken, a repeat or over the rate, and for an accepted alert
 * what its fill did once it ended. Its body stays in the inbox.
 */
export interface WebhookEventRecord {
  readonly event: number;
  readonly ruleId: Id<"whr">;
  /** The body's `id`, when it had one. */
  readonly alertId?: string;
  readonly receivedAtMs: number;
  readonly taken: "accepted" | "repeat" | "rate";
  /** An accepted alert's fill, once it ended. */
  readonly outcome?: "filled" | "skipped";
  /** A skip's reason. */
  readonly reason?: OrderFillReason;
  readonly intentId?: Id<"int">;
}

/** Parses an event row as the owner's list reads it. */
export const webhookEventRecordSchema: z.ZodType<WebhookEventRecord> = z.strictObject({
  event: rowNumberSchema,
  ruleId: idSchema("whr"),
  alertId: z.string().min(1).max(128).exactOptional(),
  receivedAtMs: epochMsSchema,
  taken: z.enum(["accepted", "repeat", "rate"]),
  outcome: z.enum(["filled", "skipped"]).exactOptional(),
  reason: orderFillReasonSchema.exactOptional(),
  intentId: idSchema("int").exactOptional(),
});

/** A page of one rule's alerts, the newest first: those below row `before`, when it is set. */
export interface WebhookEventQuery {
  readonly ruleId: Id<"whr">;
  readonly before?: number;
  readonly limit: number;
}

/** Parses a page of a rule's alerts. */
export const webhookEventQuerySchema: z.ZodType<WebhookEventQuery> = z.strictObject({
  ruleId: idSchema("whr"),
  before: rowNumberSchema.exactOptional(),
  limit: pageLimitSchema,
});
