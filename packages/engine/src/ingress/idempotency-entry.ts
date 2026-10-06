import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/**
 * One write's idempotency key (protocol spec, section 5): the caller's credential, the operation
 * and the key the client chose, with the hash of the write's args.
 */
export interface IdempotencyLookup {
  /** The caller's credential: its client token or console device id. */
  readonly credential: string;
  /** The operation, such as `intent/propose`. */
  readonly op: string;
  /** The client's key: at most 64 characters. */
  readonly key: string;
  readonly argsHash: Sha256Hex;
}

const lookupShape = {
  credential: shortTextSchema,
  op: shortTextSchema,
  key: z.string().min(1).max(64),
  argsHash: sha256HexSchema,
};

/** Parses an idempotency lookup; an entry passed as a lookup loses its result and time. */
export const idempotencyLookupSchema: z.ZodType<IdempotencyLookup> = z.object(lookupShape);

/** A write's result, stored under its idempotency key for 24 hours. */
export interface IdempotencyEntry extends IdempotencyLookup {
  readonly result: JsonValue;
  readonly atMs: number;
}

/** Parses an idempotency entry. */
export const idempotencyEntrySchema: z.ZodType<IdempotencyEntry> = z.strictObject({
  ...lookupShape,
  result: jsonValueSchema,
  atMs: epochMsSchema,
});

/**
 * What the store holds under a key: nothing yet (`new`), the result of the same write
 * (`repeat`), or a write with other args (`reused`, which fails with `protocol.key_reused`).
 */
export type IdempotencyRecall =
  | { readonly kind: "new" }
  | { readonly kind: "repeat"; readonly result: JsonValue }
  | { readonly kind: "reused" };

/** Parses what the store holds under a key. */
export const idempotencyRecallSchema: z.ZodType<IdempotencyRecall> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new") }),
  z.strictObject({ kind: z.literal("repeat"), result: jsonValueSchema }),
  z.strictObject({ kind: z.literal("reused") }),
]);
