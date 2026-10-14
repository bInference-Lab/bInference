import type { Id } from "@binference/core";

/** An auto order that authorized a fill when the engine proposed it. */
export interface OrderAuthorization {
  readonly order: Id<"ord">;
  /**
   * The fills the order had recorded when the engine proposed the fill: a live fill's grant
   * holds only while the order still has them (decision 0210). Absent on fills stored before it.
   */
  readonly fillsBefore?: number;
  /**
   * The fill's terms hash, stored as the fill is confirmed (decision 0211); absent before then and
   * on fills stored before it.
   */
  readonly termsHash?: string;
}

/** A webhook rule that authorized a fill, with the alert id the webhook sent. */
export interface WebhookRuleAuthorization {
  readonly webhookRule: Id<"whr">;
  readonly alertId: string;
}

/** The order or webhook rule a fill runs under; the owner confirmed it once, in advance. */
export type FillAuthorization = OrderAuthorization | WebhookRuleAuthorization;

/**
 * The agent's auto mode authorized the intent at `simulated`, under this version of the mode. The
 * authorization holds only while the mode keeps that version.
 */
export interface AutoModeAuthorization {
  readonly approvalMode: "auto";
  readonly modeVersion: number;
}

/**
 * What lets an intent skip its card (spec 6, section 5): a fill's order or rule, or the auto mode.
 * An intent without one waits for the owner's tap.
 */
export type Authorization = FillAuthorization | AutoModeAuthorization;

/** Whether an authorization is a fill's order or rule, not the auto mode. */
export function isFillAuthorization(
  authorization: Authorization,
): authorization is FillAuthorization {
  return !("approvalMode" in authorization);
}
