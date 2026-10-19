import { assetRefParts, type ChainRef } from "@binference/chain";
import { readHasCode, readTokenFacts } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import type { ChainReads } from "./chain-reads.js";
import type { ComposeEngineOptions } from "./compose-engine.js";
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

/**
 * Reads whether a token's address holds contract code at the latest block, through its chain's
 * failover. A token on no chain the reads hold, or that is no ERC-20, rejects: it cannot be shown
 * new. Rejects when no endpoint answers, and with the signal's reason once it aborts.
 */
export function chainTokenCode(
  reads: ReadonlyMap<ChainRef, Pick<ChainReads, "rpc">>,
): NonNullable<ComposeEngineOptions["readTokenCode"]> {
  return async (token, { signal }) => {
    const { chain } = assetRefParts(token);
    const [address] = erc20TokensOn(chain, [token]).keys();
    const rpc = reads.get(chain)?.rpc;
    if (address === undefined || rpc === undefined) {
      throw new BinferenceError({
        code: "cli.token_unreadable",
        message: "The token is no ERC-20 on a chain the engine reads.",
        details: { token },
      });
    }
    return readHasCode(rpc, { address, signal });
  };
}

/** The token reads the engine takes: what tokens answer about themselves, and whether they hold code. */
export function chainTokenReads(
  reads: ReadonlyMap<ChainRef, Pick<ChainReads, "rpc" | "multicall">>,
): Pick<ComposeEngineOptions, "readTokenFacts" | "readTokenCode"> {
  return { readTokenFacts: chainTokenFacts(reads), readTokenCode: chainTokenCode(reads) };
}
