import type { Address } from "viem";
import { hexSchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/**
 * Whether an address holds contract code at the latest block (`eth_getCode`): a token a launch is
 * about to make holds none yet. Rejects when no endpoint answers or the node refuses the call, and
 * with the signal's reason once it aborts.
 */
export async function readHasCode(
  rpc: RpcFailover,
  request: { readonly address: Address; readonly signal: AbortSignal },
): Promise<boolean> {
  const code = await requestResult(rpc, {
    method: "eth_getCode",
    params: [request.address, "latest"],
    result: hexSchema,
    signal: request.signal,
  });
  return code !== "0x";
}
