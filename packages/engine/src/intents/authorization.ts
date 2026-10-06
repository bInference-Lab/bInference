import type { Id } from "@binference/core";

/** An auto order that authorized a fill when the engine proposed it. */
export interface OrderAuthorization {
  readonly order: Id<"ord">;
}

/** A webhook rule that authorized a fill, with the alert id the webhook sent. */
export interface WebhookRuleAuthorization {
  readonly webhookRule: Id<"whr">;
  readonly alertId: string;
}

/** The order or webhook rule a fill runs under; the owner confirmed it once, in advance. */
export type FillAuthorization = OrderAuthorization | WebhookRuleAuthorization;

/**
 * What lets an intent skip its card (spec 6, section 5): a fill's order or rule. An intent without
 * one waits for the owner's tap.
 */
export type Authorization = FillAuthorization;
