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

/** A write's key as it is marked started, with no result yet (decision 0437). */
export interface IdempotencyMark extends IdempotencyLookup {
  /** When the write started; the prune counts the key's 24 hours from it until it is finished. */
  readonly atMs: number;
}

/** Parses a mark of a write's key. */
export const idempotencyMarkSchema: z.ZodType<IdempotencyMark> = z.strictObject({
  ...lookupShape,
  atMs: epochMsSchema,
});

/**
 * What marking a key answers (decision 0437): it is now `started` and its write may run; it holds
 * the result of the same write (`repeat`); it holds a write with other args (`reused`); or the
 * same write was started and has no result (`unfinished`): the engine start that ran it can write
 * no more, so its outcome is unknown.
 */
export type IdempotencyStart =
  | { readonly kind: "started" }
  | { readonly kind: "repeat"; readonly result: JsonValue }
  | { readonly kind: "reused" }
  | { readonly kind: "unfinished" };

/** Parses what marking a key answers. */
export const idempotencyStartSchema: z.ZodType<IdempotencyStart> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("started") }),
  z.strictObject({ kind: z.literal("repeat"), result: jsonValueSchema }),
  z.strictObject({ kind: z.literal("reused") }),
  z.strictObject({ kind: z.literal("unfinished") }),
]);

/**
 * What a prune removes: every key started or stored before `beforeMs`, but the marks of the writes
 * the running engine start still runs (decision 0437), which outlast their 24 hours.
 */
export interface IdempotencyPrune {
  readonly beforeMs: number;
  readonly running: readonly IdempotencyLookup[];
}

/** Parses a prune of the idempotency store. */
export const idempotencyPruneSchema: z.ZodType<IdempotencyPrune> = z.strictObject({
  beforeMs: epochMsSchema,
  running: z.array(idempotencyLookupSchema).max(10_000),
});

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
