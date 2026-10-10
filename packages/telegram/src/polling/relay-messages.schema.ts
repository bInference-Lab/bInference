import { z } from "zod";
import type { BotApiAnswer, BotApiRequest } from "../api/bot-api-fetch.js";

/** A Bot API request the poll worker asks the parent to send through its outbound HTTP. */
export interface RelayCall extends BotApiRequest {
  readonly kind: "http";
  readonly id: number;
}

/** What the poll worker sends the parent: a request, or the end of one it no longer waits for. */
export type RelayRequest = RelayCall | { readonly kind: "http_cancel"; readonly id: number };

/** The parent's answer to one relayed request, or word that it got none. */
export type RelayAnswer =
  | { readonly kind: "http_answer"; readonly id: number; readonly answer: BotApiAnswer }
  | {
      readonly kind: "http_fault";
      readonly id: number;
      /** Whether the request never reached Telegram: no connection opened. */
      readonly isUnsent: boolean;
    };

const relayId = z.int().positive();

const relayRequestSchema: z.ZodType<RelayRequest> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("http"),
    id: relayId,
    method: z.enum(["GET", "POST"]),
    url: z.url(),
    headers: z.record(z.string(), z.string()),
    body: z.string().exactOptional(),
  }),
  z.strictObject({ kind: z.literal("http_cancel"), id: relayId }),
]);

const relayAnswerSchema: z.ZodType<RelayAnswer> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("http_answer"),
    id: relayId,
    answer: z.strictObject({
      status: z.int().min(100).max(599),
      contentType: z.string().exactOptional(),
      body: z.string(),
    }),
  }),
  z.strictObject({ kind: z.literal("http_fault"), id: relayId, isUnsent: z.boolean() }),
]);

/** Reads a poll worker's message to the parent; `undefined` when it is not a relay request. */
export function relayRequestOf(value: unknown): RelayRequest | undefined {
  const parsed = relayRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Reads the parent's message to a poll worker; `undefined` when it is not a relay answer. */
export function relayAnswerOf(value: unknown): RelayAnswer | undefined {
  const parsed = relayAnswerSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
