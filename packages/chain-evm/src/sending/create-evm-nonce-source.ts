import { type AccountRef, accountRefParts, type NonceSource } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { parseEvmAddress } from "../evm-address.js";
import type { EvmChain } from "../evm-chain.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** What the EVM nonce source reads: one chain, through its RPC failover. */
export interface EvmNonceSourceOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
}

// A nonce is a safe integer: an account never sends 2^53 transactions.
const nonceSchema: z.ZodType<number, string> = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,13}$/)
  .transform((text) => z.coerce.number().pipe(z.int().nonnegative()).parse(text));

function addressOn(chain: EvmChain, account: AccountRef): string {
  const { chain: accountChain, address } = accountRefParts(account);
  const parsed = parseEvmAddress(address);
  if (accountChain !== chain.ref || !parsed.ok) {
    throw new BinferenceError({
      code: "chain.unknown_chain",
      message: `This nonce source reads accounts on ${chain.name} only.`,
      details: { chain: accountChain },
    });
  }
  return parsed.value;
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
      const address = addressOn(options.chain, account);
      return requestResult(options.rpc, {
        method: "eth_getTransactionCount",
        params: [address, "pending"],
        result: nonceSchema,
        signal,
      });
    },
  };
}
