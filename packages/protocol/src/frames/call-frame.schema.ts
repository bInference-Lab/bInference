import { z } from "zod";

/**
 * Parses the id a client gives a call: unique per connection, 1 to 64 characters. The `reply` or
 * `fail` that answers the call carries the same id; answers can arrive out of order.
 */
export const callIdSchema: z.ZodType<string> = z.string().min(1).max(64);

/**
 * Parses an idempotency key: 1 to 64 characters, unique per intended action, such as a UUIDv7.
 * The same key with the same args returns the stored result for 24 hours.
 */
export const idempotencyKeySchema: z.ZodType<string, string> = z.string().min(1).max(64);

/**
 * A client's call of one operation, named `domain/action`. `args` is checked against the
 * operation's own schema, which refuses unknown fields. `key` is the idempotency key every write
 * needs: 1 to 64 characters, unique per intended action.
 */
export interface CallFrame {
  readonly t: "call";
  readonly id: string;
  readonly op: string;
  readonly args: unknown;
  readonly key?: string;
}

/** Parses a `call` frame. An unknown operation parses here and fails later with its own code. */
export const callFrameSchema: z.ZodType<CallFrame> = z.object({
  t: z.literal("call"),
  id: callIdSchema,
  op: z.string().regex(/^[a-z][a-zA-Z0-9]*\/[a-z][a-zA-Z0-9]*$/),
  args: z.unknown(),
  key: idempotencyKeySchema.exactOptional(),
});
