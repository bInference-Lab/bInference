import { BinferenceError } from "@binference/core";
import { createPublicClient, custom, defineChain, type PublicClient, RpcRequestError } from "viem";
import type { EvmChain } from "../evm-chain.js";
import { type JsonValue, jsonValueSchema } from "./json-value.schema.js";
import type { RpcFailover } from "./rpc-call.js";
import { type ViemRequest, viemRequestSchema } from "./viem-request.schema.js";

/** What a viem client is built from. */
export interface EvmClientOptions {
  readonly chain: EvmChain;
  readonly rpc: RpcFailover;
  /**
   * viem's actions take no signal, so the client carries one: every request it sends stops when
   * this signal aborts, and each still has the failover's timeout per endpoint.
   */
  readonly signal: AbortSignal;
}

function readViemRequest(args: Readonly<Record<string, JsonValue>>): ViemRequest {
  const parsed = viemRequestSchema.safeParse(args);
  if (!parsed.success) {
    throw new BinferenceError({
      code: "chain.rpc_bad_request",
      message: "viem asked for a request whose params are not plain JSON.",
    });
  }
  return parsed.data;
}

/**
 * Creates a viem public client whose every request goes through the failover. viem's own retries
 * are off. A JSON-RPC error answer reaches viem as its `RpcRequestError`, so viem decodes reverts
 * as usual; a failover fault, such as `chain.rpc_down`, arrives as the `cause` of viem's error.
 */
export function createEvmClient(options: EvmClientOptions): PublicClient {
  const { chain, rpc, signal } = options;
  const provider = {
    async request(args: Readonly<Record<string, JsonValue>>): Promise<JsonValue> {
      const { method, params } = readViemRequest(args);
      const reply = await rpc.request({ method, params, result: jsonValueSchema, signal });
      if (reply.kind === "result") {
        return reply.value;
      }
      const { code, message, data } = reply;
      throw new RpcRequestError({
        body: { method, params },
        error: { code, message, data },
        url: reply.endpoint,
      });
    },
  };
  return createPublicClient({
    chain: defineChain({
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: {
        name: chain.nativeSymbol,
        symbol: chain.nativeSymbol,
        decimals: chain.nativeDecimals,
      },
      rpcUrls: { default: { http: [] } },
    }),
    transport: custom(provider, { retryCount: 0 }),
  });
}
