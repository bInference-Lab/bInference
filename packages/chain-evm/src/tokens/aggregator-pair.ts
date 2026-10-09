import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  type ChainRef,
} from "@binference/chain";
import type { Address } from "viem";
import { type AggregatorChain, aggregatorTokenOf } from "./aggregator-token.js";

/** A trade an aggregator is asked about: who trades, the exact input and the asset bought. */
export interface AggregatorTrade {
  readonly wallet: AccountRef;
  readonly amountIn: Amount;
  readonly assetOut: AssetRef;
}

/** A trade as an aggregator writes it: the chain it trades on and the two token addresses. */
export interface AggregatorPair<C extends AggregatorChain> {
  readonly on: C;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
}

/**
 * The trade as an aggregator writes it on the wallet's chain, from the chains it trades on.
 * Undefined on a chain it does not trade on, or with an asset it does not trade there.
 */
export function aggregatorPairOf<C extends AggregatorChain>(
  trade: AggregatorTrade,
  chains: ReadonlyMap<ChainRef, C>,
): AggregatorPair<C> | undefined {
  const on = chains.get(accountRefParts(trade.wallet).chain);
  const tokenIn = on === undefined ? undefined : aggregatorTokenOf(trade.amountIn.asset, on);
  const tokenOut = on === undefined ? undefined : aggregatorTokenOf(trade.assetOut, on);
  return on === undefined || tokenIn === undefined || tokenOut === undefined
    ? undefined
    : { on, tokenIn, tokenOut };
}
