import { type Id, idSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** A repeat is an accepted alert of the same rule with the same `id` or body within this time. */
export const webhookRepeatWindowMs = 600_000;

/** A rule's rate counts the alerts it accepted within this time. */
export const webhookRateWindowMs = 60_000;

/** The longest `id` an alert's body may carry (decision 0299). */
const maxWebhookAlertIdLength = 128;

/** Where a webhook rule stands: its URL answers only while it is `active`. */
type WebhookRuleState = "awaiting_confirmation" | "active" | "deleted";

const ruleStateSchema = z.enum(["awaiting_confirmation", "active", "deleted"]);

/**
 * What the webhook listener reads of a rule: the SHA-256 of its secret, its state, its rate and
 * its expiry. The secret is the URL's last segment, 32 random bytes in base64url, hashed as its
 * UTF-8 text.
 */
export interface WebhookRuleKey {
  readonly id: Id<"whr">;
  readonly secretHash: Sha256Hex;
  readonly state: WebhookRuleState;
  /** The alerts it accepts in any 60 seconds, 1 to 60. */
  readonly ratePerMinute: number;
  readonly expiresAtMs?: number;
}

/** Parses a rule's key. */
export const webhookRuleKeySchema: z.ZodType<WebhookRuleKey> = z.strictObject({
  id: idSchema("whr"),
  secretHash: sha256HexSchema,
  state: ruleStateSchema,
  ratePerMinute: z.int().min(1).max(60),
  expiresAtMs: epochMsSchema.exactOptional(),
});

/**
 * An alert's body as it is stored: its text when it is UTF-8, else its bytes in base64. Nothing
 * in it sets a fill's size or side (decision 0299).
 */
type WebhookBody = { readonly text: string } | { readonly base64: string };

// At most 16 KiB of bytes: as many UTF-16 units of text at most, or their base64.
const webhookBodySchema: z.ZodType<WebhookBody> = z.union([
  z.strictObject({ text: z.string().max(16_384) }),
  z.strictObject({ base64: z.base64().max(21_848) }),
]);

/**
 * An alert whose rule and secret matched, to record: its body, the body's hash, and the body's
 * `id` when it is a JSON object that carries one. `secretHash` is the hash it matched, so an
 * alert the rule's new URL replaced in the meantime is `gone`.
 */
export interface WebhookAlertDraft {
  readonly rule: Id<"whr">;
  readonly secretHash: Sha256Hex;
  readonly alertId?: string;
  readonly body: WebhookBody;
  readonly bodyHash: Sha256Hex;
  readonly receivedAtMs: number;
}

/** Parses an alert to record. */
export const webhookAlertDraftSchema: z.ZodType<WebhookAlertDraft> = z.strictObject({
  rule: idSchema("whr"),
  secretHash: sha256HexSchema,
  alertId: z.string().min(1).max(maxWebhookAlertIdLength).exactOptional(),
  body: webhookBodySchema,
  bodyHash: sha256HexSchema,
  receivedAtMs: epochMsSchema,
});

/**
 * What became of an alert: `accepted` with its `webhook_events` row and the inbox entry that
 * carries it on; `repeat` or `rate` with its row; `gone` when its rule no longer answers,
 * recording nothing.
 */
export type WebhookTake =
  | { readonly kind: "accepted"; readonly event: number; readonly entry: number }
  | { readonly kind: "repeat" | "rate"; readonly event: number }
  | { readonly kind: "gone" };

/** Parses what became of an alert. */
export const webhookTakeSchema: z.ZodType<WebhookTake> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("accepted"), event: rowNumberSchema, entry: rowNumberSchema }),
  z.strictObject({ kind: z.enum(["repeat", "rate"]), event: rowNumberSchema }),
  z.strictObject({ kind: z.literal("gone") }),
]);

/** The source key prefix of every webhook alert in the inbox. */
export const webhookInboxPrefix = "wh:";

/** The inbox key of an accepted alert, by its `webhook_events` row. */
export function webhookInboxKey(event: number): string {
  return `${webhookInboxPrefix}${String(event)}`;
}

/**
 * The payload of an accepted alert's inbox entry: its rule, its `webhook_events` row, its `id`
 * when it has one, and its body.
 */
export function webhookInboxPayload(draft: WebhookAlertDraft, event: number): JsonValue {
  const alertId = draft.alertId === undefined ? {} : { alertId: draft.alertId };
  return { rule: draft.rule, event, ...alertId, body: { ...draft.body } };
}

/** Whether a rule's URL answers at `nowMs`: it is `active` and not past its expiry. */
export function isAnswering(
  rule: Pick<WebhookRuleKey, "state" | "expiresAtMs">,
  nowMs: number,
): boolean {
  return rule.state === "active" && (rule.expiresAtMs === undefined || nowMs < rule.expiresAtMs);
}
