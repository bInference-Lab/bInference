import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import {
  readWebhookRuleRequestSchema,
  type WebhookRuleRequest,
} from "../requests/fill-rule-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** A webhook rule without its secret URL, which only its creation and rotation show. */
export interface WebhookRuleView {
  readonly rule: ProtocolId<"webhookRule">;
  readonly agent: ProtocolId<"agent">;
  readonly state: "awaiting_confirmation" | "active" | "deleted";
  readonly request: WebhookRuleRequest;
  readonly fills: number;
  readonly createdAt: number;
  readonly changedAt: number;
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
});
