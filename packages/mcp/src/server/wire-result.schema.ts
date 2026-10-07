import { z } from "zod";

/** An operation's result as JSON carries it: amounts as decimal strings, times as numbers. */
export type WireResult = Readonly<Record<string, unknown>>;

const wireResultSchema: z.ZodType<WireResult> = z.record(z.string(), z.json());

/**
 * Encodes an operation's result with its own schema into the JSON object the engine sent, so an
 * MCP client reads amounts as decimal strings. None when the result breaks its schema or is not
 * an object; the protocol client already parsed it, so that is a fault of the code, not the input.
 */
export function wireResultOf<Result>(
  schema: z.ZodType<Result>,
  result: Result,
): WireResult | undefined {
  // An explicit type argument keeps the generic result type; inference would widen it.
  const encoded = z.safeEncode<z.ZodType<Result>>(schema, result);
  const wire = encoded.success ? wireResultSchema.safeParse(encoded.data) : undefined;
  return wire?.success === true ? wire.data : undefined;
}
