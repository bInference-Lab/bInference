import { BinferenceError } from "@binference/core";
import type { RpcCall, RpcFailover } from "./rpc-call.js";

/**
 * Sends a call whose JSON-RPC error has no expected meaning and gives its result. An error answer
 * is a `chain.rpc_error` fault carrying the node's error code and the endpoint's name.
 */
export async function requestResult<T>(rpc: RpcFailover, call: RpcCall<T>): Promise<T> {
  const reply = await rpc.request(call);
  if (reply.kind === "result") {
    return reply.value;
  }
  throw new BinferenceError({
    code: "chain.rpc_error",
    message: `${call.method} failed on ${reply.endpoint}: ${reply.message}`,
    details: { method: call.method, endpoint: reply.endpoint, rpcCode: reply.code },
  });
}
