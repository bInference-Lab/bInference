import { type Id, idSchema } from "@binference/core";
import {
  type WebhookRuleCardRequest,
  type WebhookRuleRequest,
  webhookRuleRequestSchema,
} from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * What a rule's card confirms (decision 0299): the rule, its request with every default filled,
 * and its mode. The `webhookRule` intent keeps it in its `quote` column, so the card's terms hash
 * binds it.
 */
export interface WebhookRuleQuote {
  readonly rule: Id<"whr">;
  readonly request: WebhookRuleRequest;
  readonly ratePerMinute: number;
  readonly expiresAtMs: number;
  /** Absent: no limit on its fills. */
  readonly maxFills?: number;
  readonly isPaper: boolean;
  readonly quotedAtMs: number;
}

/** A rule's quote, in the `quote` column of its `webhookRule` intent. */
export const webhookRuleQuoteDocument: DocumentCodec<WebhookRuleQuote> = documentCodec(
  "webhook rule quote",
  z.strictObject({
    rule: idSchema("whr"),
    request: webhookRuleRequestSchema,
    ratePerMinute: z.int().min(1).max(60),
    expiresAtMs: epochMsSchema,
    maxFills: z.int().min(1).exactOptional(),
    isPaper: z.boolean(),
    quotedAtMs: epochMsSchema,
  }),
);

/** The request a `webhookRule` intent stores: the rule whose card it carries. */
export const webhookRuleCardRequestDocument: DocumentCodec<WebhookRuleCardRequest> = documentCodec(
  "webhook rule card request",
  z.strictObject({ kind: z.literal("webhookRule"), rule: idSchema("whr") }),
);
