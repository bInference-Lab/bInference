import { z } from "zod";
import { quantitySchema } from "../rpc/evm-wire.schema.js";

/**
 * What a node sent over a `newHeads` subscription, as the execution APIs' `eth_subscribe` writes
 * it: the answer to the subscribe request, or a notification of a new block header.
 */
export type HeadMessage =
  | { readonly kind: "subscribed"; readonly subscription: string }
  | { readonly kind: "refused" }
  | { readonly kind: "head"; readonly subscription: string; readonly number: bigint };

/** The JSON-RPC id of the one request a head socket sends: its `eth_subscribe`. */
const subscribeId = 1;

const subscribedSchema = z.looseObject({
  id: z.literal(subscribeId),
  result: z.string().min(1),
});
const refusedSchema = z.looseObject({
  id: z.literal(subscribeId),
  error: z.looseObject({ code: z.int() }),
});
const headSchema = z.looseObject({
  method: z.literal("eth_subscription"),
  params: z.looseObject({
    subscription: z.string().min(1),
    result: z.looseObject({ number: quantitySchema }),
  }),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads one message of a head socket; any other message, such as a ping's, is undefined. */
export function readHeadMessage(text: string): HeadMessage | undefined {
  const json = parseJson(text);
  const head = headSchema.safeParse(json);
  if (head.success) {
    const { subscription, result } = head.data.params;
    return { kind: "head", subscription, number: result.number };
  }
  const subscribed = subscribedSchema.safeParse(json);
  if (subscribed.success) {
    return { kind: "subscribed", subscription: subscribed.data.result };
  }
  return refusedSchema.safeParse(json).success ? { kind: "refused" } : undefined;
}

/** The text of the request that subscribes a socket to new block headers. */
export const subscribeRequest: string = JSON.stringify({
  jsonrpc: "2.0",
  id: subscribeId,
  method: "eth_subscribe",
  params: ["newHeads"],
});
