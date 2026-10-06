import { z } from "zod";
import { type JsonValue, jsonValueSchema } from "./json-value.schema.js";

/** A JSON-RPC error object. */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: JsonValue | undefined;
}

/** A JSON-RPC reply with a result. */
interface JsonRpcResult {
  readonly id: number;
  readonly result: JsonValue;
}

/** A JSON-RPC reply with an error; the id is null when the node could not read the request. */
interface JsonRpcFailure {
  readonly id: number | null;
  readonly error: JsonRpcError;
}

/** A JSON-RPC 2.0 reply to one request. */
export type JsonRpcReply = JsonRpcResult | JsonRpcFailure;

const errorSchema = z.looseObject({
  code: z.int(),
  message: z.string(),
  data: jsonValueSchema.optional(),
});

const replySchema: z.ZodType<JsonRpcReply> = z.union([
  z.looseObject({ jsonrpc: z.literal("2.0"), id: z.int().nullable(), error: errorSchema }),
  z.looseObject({ jsonrpc: z.literal("2.0"), id: z.int(), result: jsonValueSchema }),
]);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads a JSON-RPC reply from an HTTP body; anything else is undefined. */
export function readJsonRpcReply(body: string): JsonRpcReply | undefined {
  const parsed = replySchema.safeParse(parseJson(body));
  return parsed.success ? parsed.data : undefined;
}
