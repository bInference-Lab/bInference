import { type JsonValue, jsonValueSchema } from "@binference/core";
import type { TransactionSerialized } from "viem";
import { z } from "zod";

/**
 * Parses signed EVM bytes as a relay receives them: a typed transaction (types 1 to 4) or a
 * legacy RLP list, in hex.
 */
export const signedBytesSchema: z.ZodType<TransactionSerialized> = z.custom<TransactionSerialized>(
  (value) => typeof value === "string" && /^0x(?:0[1-4]|[c-f][0-9a-f])[0-9a-f]*$/i.test(value),
);

/** One JSON-RPC request the engine sent to the test's chain or relays. */
export interface ChainRequest {
  readonly id?: JsonValue;
  readonly method: string;
  readonly params: readonly JsonValue[];
}

// One JSON-RPC request; a batch or anything else is not one.
const chainRequestSchema: z.ZodType<ChainRequest> = z.looseObject({
  id: jsonValueSchema.exactOptional(),
  method: z.string(),
  params: z.array(jsonValueSchema).prefault([]),
});

/** anvil's answer to one request: its result, or the error it gave. */
export type ChainReply =
  | { readonly result: JsonValue }
  | { readonly error: { readonly code: number; readonly message: string } };

// anvil's answer to one request.
const chainReplySchema: z.ZodType<ChainReply> = z.union([
  z.looseObject({ result: jsonValueSchema }),
  z.looseObject({ error: z.looseObject({ code: z.int(), message: z.string() }) }),
]);

/** Reads a request's body: the request, or `undefined` for a batch or a body that is no JSON-RPC. */
export function readChainRequest(text: string): ChainRequest | undefined {
  try {
    const parsed = chainRequestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Reads anvil's answer to one request; throws when it is neither a result nor an error. */
export function readChainReply(text: string): ChainReply {
  return chainReplySchema.parse(JSON.parse(text));
}
