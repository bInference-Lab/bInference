import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import {
  readWebhookRuleRequestSchema,
  type WebhookRuleRequest,
} from "../requests/fill-rule-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type CardLineView, cardLineViewSchema } from "./card-lines.schema.js";

/** A webhook rule without its secret URL, which only its creation and rotation show. */
export interface WebhookRuleView {
  readonly rule: ProtocolId<"webhookRule">;
  readonly agent: ProtocolId<"agent">;
  readonly state: "awaiting_confirmation" | "active" | "deleted";
  /** Its bounds with every default filled: its wallet, its expiry and its rate. */
  readonly request: WebhookRuleRequest;
  readonly fills: number;
  readonly createdAt: number;
  readonly changedAt: number;
  /** The alerts it accepts in any 60 seconds (decision 0299). */
  readonly ratePerMinute?: number;
  /** When it last accepted an alert. */
  readonly lastAlertAt?: number;
  /** The `webhookRule` intent that carries its card. */
  readonly intent?: ProtocolId<"intent">;
  /**
   * What each alert trades, as its card words it (`card.webhookRule.buy` or `.sell`); a surface
   * shows it with `cardLineText` and the list's `assets`.
   */
  readonly summary?: CardLineView;
}

/** Parses a webhook rule view. */
export const webhookRuleViewSchema: z.ZodType<WebhookRuleView> = z.object({
  rule: protocolIdSchema("webhookRule"),
  agent: protocolIdSchema("agent"),
  state: z.enum(["awaiting_confirmation", "active", "deleted"]),
  request: readWebhookRuleRequestSchema,
  fills: z.int().nonnegative(),
  createdAt: epochMsSchema,
  changedAt: epochMsSchema,
  ratePerMinute: z.int().min(1).max(60).exactOptional(),
  lastAlertAt: epochMsSchema.exactOptional(),
  intent: protocolIdSchema("intent").exactOptional(),
  summary: cardLineViewSchema.exactOptional(),
});
