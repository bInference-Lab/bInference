import type { ChainRef } from "@binference/chain";
import { readTokenFacts } from "@binference/chain-evm";
import type { EngineOptions } from "@binference/engine";
import type { ChainReads } from "./chain-reads.js";
import { erc20TokensOn } from "./token-decimals.js";

/**
 * Reads what tokens answer about themselves on chain, their symbol, name and decimals: one
 * Multicall3 call per chain that holds any of them, through the chain's failover. A token that
 * answers no symbol or no decimals is left out. Rejects when no endpoint answers, and with the
 * signal's reason once it aborts.
 */
export function chainTokenFacts(
  reads: ReadonlyMap<ChainRef, Pick<ChainReads, "rpc" | "multicall">>,
): EngineOptions["readTokenFacts"] {
  return async (tokens, { signal }) => {
    const found = await Promise.all(
      [...reads].map(async ([chain, { rpc, multicall }]) => {
        const own = erc20TokensOn(chain, tokens);
        if (own.size === 0) {
          return [];
        }
        const facts = await readTokenFacts(rpc, { multicall, tokens: [...own.keys()], signal });
        return [...facts].flatMap(([address, answered]) => {
          const token = own.get(address);
          return token === undefined ? [] : [[token, answered] as const];
        });
      }),
    );
    return new Map(found.flat());
  };
}
