import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * What one alert to a webhook rule's URL became, as `webhook_events` keeps it (protocol spec,
 * section 7.5): taken, a repeat or over the rule's rate, and for a taken alert what its fill did
 * once it ended. It never carries the alert's body.
 */
export interface WebhookEventView {
  /** Its `webhook_events` row, which keys its fill (decision 0338). */
  readonly event: number;
  readonly receivedAt: number;
  /** `accepted` alerts fill; a repeat or one over the rate is only recorded (decision 0333). */
  readonly taken: "accepted" | "repeat" | "rate";
  /** The body's `id`, when it had one. */
  readonly alertId?: string;
  /** What an accepted alert's fill did, once it ended. */
  readonly fill?: "filled" | "skipped";
  /** Why a fill was skipped, a reason code such as `late` or `daily_cap`. */
  readonly reason?: string;
  /** The intent that filled, or that ended with the skip. */
  readonly intent?: ProtocolId<"intent">;
}

/** Parses a webhook event view. */
export const webhookEventViewSchema: z.ZodType<WebhookEventView> = z.object({
  event: z.int().positive(),
  receivedAt: epochMsSchema,
  taken: z.enum(["accepted", "repeat", "rate"]),
  alertId: z.string().min(1).max(128).exactOptional(),
  fill: z.enum(["filled", "skipped"]).exactOptional(),
  reason: z
    .string()
    .regex(/^[a-z][a-z_]*$/)
    .exactOptional(),
  intent: protocolIdSchema("intent").exactOptional(),
});
