import { BinferenceError, type JsonValue, jsonValueSchema } from "@binference/core";
import type { Operation } from "@binference/protocol";
import { z } from "zod";

/**
 * Encodes a result with its operation's schema into the JSON a `reply` carries, so a `bigint`
 * amount becomes its decimal string. Throws `server.bad_result` for a result that breaks the
 * schema: the handler, not the client, is at fault.
 */
export function encodeResult<Args, Result>(
  operation: Operation<Args, Result>,
  value: Result,
): JsonValue {
  // An explicit type argument keeps the generic result type; inference would widen it.
  const encoded = z.safeEncode<z.ZodType<Result>>(operation.result, value);
  const json = encoded.success ? jsonValueSchema.safeParse(encoded.data) : undefined;
  if (json?.success !== true) {
    throw new BinferenceError({
      code: "server.bad_result",
      message: `The result of ${operation.name} breaks its schema.`,
      details: { op: operation.name },
    });
  }
  return json.data;
}
