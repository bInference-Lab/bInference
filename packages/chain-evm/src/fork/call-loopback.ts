import { BinferenceError } from "@binference/core";
import { readJsonRpcReply } from "../rpc/json-rpc-reply.schema.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { createLoopbackHttp } from "../testing/loopback-http.js";

/** One JSON-RPC request to an endpoint of the fork suite. */
export interface LoopbackCall {
  /** The endpoint, on 127.0.0.1. */
  readonly rpcUrl: string;
  readonly method: string;
  readonly params: readonly JsonValue[];
}

const http = createLoopbackHttp();

/**
 * Sends one JSON-RPC request straight to an endpoint on 127.0.0.1, past the RPC failover: the
 * failover refuses sends, and anvil's own methods, such as `anvil_setCode` or `evm_snapshot`,
 * change the fork instead of reading it. A JSON-RPC error rejects with the endpoint's message.
 */
export async function callLoopback(call: LoopbackCall, signal: AbortSignal): Promise<JsonValue> {
  const { rpcUrl, method, params } = call;
  const response = await http.request({
    method: "POST",
    url: rpcUrl,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  const reply = readJsonRpcReply(response.body);
  if (reply === undefined || "error" in reply) {
    const reason = reply?.error.message ?? `HTTP ${String(response.status)}`;
    throw new BinferenceError({
      code: "fork.call_refused",
      message: `${method} was refused: ${reason}`,
      details: { method },
    });
  }
  return reply.result;
}
