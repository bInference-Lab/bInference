import { type AssetRef, assetRefParts, type ChainRef } from "@binference/chain";
import { parseEvmAddress, readTokenDecimals } from "@binference/chain-evm";
import type { Address } from "viem";
import type { ChainReads } from "./chain-reads.js";

/** Reads the decimals of tokens; a token whose decimals cannot be read is left out. */
export type ReadDecimals = (
  tokens: readonly AssetRef[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<AssetRef, number>>;

// The ERC-20 tokens of one chain among the tokens, by address.
function tokensOn(chain: ChainRef, tokens: readonly AssetRef[]): ReadonlyMap<Address, AssetRef> {
  return new Map(
    tokens.flatMap((token) => {
      const parts = assetRefParts(token);
      const address = parseEvmAddress(parts.assetReference);
      const isToken = parts.chain === chain && parts.assetNamespace === "erc20" && address.ok;
      return isToken ? [[address.value, token] as const] : [];
    }),
  );
}

/**
 * Reads tokens' decimals on chain: one Multicall3 call per chain that holds any of them, through
 * the chain's failover. Rejects when no endpoint answers, and with the signal's reason once it
 * aborts.
 */
export function chainTokenDecimals(reads: ReadonlyMap<ChainRef, ChainReads>): ReadDecimals {
  return async (tokens, signal) => {
    const found = await Promise.all(
      [...reads].map(async ([chain, { rpc, multicall }]) => {
        const own = tokensOn(chain, tokens);
        const decimals = await readTokenDecimals(rpc, {
          multicall,
          tokens: [...own.keys()],
          signal,
        });
        return [...decimals].flatMap(([address, value]) => {
          const token = own.get(address);
          return token === undefined ? [] : [[token, value] as const];
        });
      }),
    );
    return new Map(found.flat());
  };
}
