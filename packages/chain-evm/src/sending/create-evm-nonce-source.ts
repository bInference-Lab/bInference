import type { NonceSource } from "@binference/chain";
import type { EvmChain } from "../evm-chain.js";
import { nonceCountSchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { accountAddressOn } from "./account-address-on.js";

/** What the EVM nonce source reads: one chain, through its RPC failover. */
export interface EvmNonceSourceOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
}

/**
 * Creates the `NonceSource` of one EVM chain: `eth_getTransactionCount` at `pending` through the
 * RPC failover. A node does not see what private relays hold, so the wallet queue takes this count
 * as a lower bound only. An account of another chain is a fault.
 */
export function createEvmNonceSource(options: EvmNonceSourceOptions): NonceSource {
  return {
    async next(account, { signal }) {
      signal.throwIfAborted();
      const address = accountAddressOn(options.chain, account);
      return requestResult(options.rpc, {
        method: "eth_getTransactionCount",
        params: [address, "pending"],
        result: nonceCountSchema,
        signal,
      });
    },
  };
}
