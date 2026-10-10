import type { Amount, ChainRef } from "@binference/chain";
import { erc20AssetRef, parseEvmAddress } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { baseUnitsOf } from "../init/base-units.js";
import type { ChainReads } from "./chain-reads.js";

function refuse(symbol: string): BinferenceError {
  return new BinferenceError({
    code: "cli.bad_paper_balance",
    message: `defaults.paper.balances names ${symbol}, which no enabled chain lists in that amount.`,
    details: { symbol },
  });
}

// The symbol's asset and decimals on a chain: its coin, or a registry token.
function assetOn(reads: ChainReads, symbol: string) {
  const { evm, chain } = reads;
  if (symbol === evm.nativeSymbol) {
    return { asset: evm.nativeAsset, decimals: evm.nativeDecimals };
  }
  const token = chain.definition.tokens.find((item) => item.symbol === symbol);
  const address = token === undefined ? undefined : parseEvmAddress(token.address);
  return token === undefined || address?.ok !== true
    ? undefined
    : { asset: erc20AssetRef(evm, address.value), decimals: token.decimals };
}

/**
 * What a paper portfolio starts with (decision 0069): config's `defaults.paper.balances`, each
 * symbol the coin or a registry token of the first enabled chain that lists it, in its base units.
 * A symbol no enabled chain lists, or an amount with more decimals than the asset has, is a
 * `cli.bad_paper_balance` fault, so a start never runs on a starting balance it misread.
 */
export function paperBalancesOf(
  balances: Readonly<Record<string, string>>,
  reads: ReadonlyMap<ChainRef, ChainReads>,
): readonly Amount[] {
  return Object.entries(balances).map(([symbol, text]): Amount => {
    const found = [...reads.values()]
      .map((chain) => assetOn(chain, symbol))
      .find((item) => item !== undefined);
    const base = found === undefined ? undefined : baseUnitsOf(text, found.decimals);
    if (found === undefined || base === undefined) {
      throw refuse(symbol);
    }
    return { asset: found.asset, base };
  });
}
