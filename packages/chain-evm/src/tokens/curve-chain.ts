import {
  type Amount,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  type ChainRef,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type Address, zeroAddress } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** One chain a launchpad's curves trade on, as the composition root gives it. */
export interface CurveChain {
  readonly chain: ChainRef;
  /** The chain's own coin, which a curve may trade against. */
  readonly nativeAsset: AssetRef;
  /**
   * The tokens besides the coin a curve the launchpad quotes may trade against, from the chain
   * registry. A curve that trades against any other token is still the launchpad's, but it quotes
   * none of its trades.
   */
  readonly quoteTokens: readonly AssetRef[];
  /** The chain's RPC failover, through which the launchpad reads its contracts. */
  readonly rpc: RpcFailover;
}

/** What a launchpad knows about one chain it trades on: {@link CurveChain}, quote tokens by address. */
export interface CurveChainSetup {
  readonly chain: ChainRef;
  readonly nativeAsset: AssetRef;
  readonly quoteTokens: ReadonlyMap<Address, AssetRef>;
  readonly rpc: RpcFailover;
}

/** The launchpad whose chains are read: its id, which names its faults, and its name. */
export interface CurveVenue {
  readonly id: string;
  readonly name: string;
}

/**
 * A trade on a launchpad's curve: which side it is, the token on the curve, what the trade pays
 * with or receives (the chain's coin or a quote token), and the two addresses it trades, the coin
 * written as the zero address.
 */
export interface CurveSide {
  readonly side: "buy" | "sell";
  readonly token: Address;
  readonly quote: Address;
  readonly inputToken: Address;
  readonly outputToken: Address;
}

function refuse(venue: CurveVenue, chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: `${venue.id}.bad_options`,
    message: `${venue.name} cannot trade on ${chain}: ${problem}`,
    details: { chain },
  });
}

// An ERC-20 token of the chain, by its address in checksum form.
function tokenEntry(venue: CurveVenue, item: CurveChain, asset: AssetRef): [Address, AssetRef] {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const address = parseEvmAddress(assetReference);
  if (chain !== item.chain || assetNamespace !== "erc20" || !address.ok) {
    throw refuse(venue, item.chain, "a quote token is no ERC-20 token of the chain.");
  }
  return [address.value, asset];
}

function setupOf(venue: CurveVenue, item: CurveChain): CurveChainSetup {
  const native = assetRefParts(item.nativeAsset);
  if (native.chain !== item.chain || native.assetNamespace !== "slip44") {
    throw refuse(venue, item.chain, "its native asset is not the chain's own coin.");
  }
  const quoteTokens = new Map(item.quoteTokens.map((asset) => tokenEntry(venue, item, asset)));
  if (quoteTokens.size !== item.quoteTokens.length) {
    throw refuse(venue, item.chain, "a quote token is named twice.");
  }
  return { chain: item.chain, nativeAsset: item.nativeAsset, quoteTokens, rpc: item.rpc };
}

/**
 * Reads the chains a launchpad trades on, keyed by chain. No chain, a chain named twice, a native
 * asset that is not the chain's coin, or a quote token that is no ERC-20 token of the chain is a
 * fault (`<venue>.bad_options`), so the venue fails when it is made, never when it trades.
 */
export function curveChainSetupsOf(
  chains: readonly CurveChain[],
  venue: CurveVenue,
): ReadonlyMap<ChainRef, CurveChainSetup> {
  const setups = new Map(chains.map((item) => [item.chain, setupOf(venue, item)]));
  if (setups.size === 0 || setups.size !== chains.length) {
    throw refuse(venue, "its chains", "name at least one chain, and each chain once.");
  }
  return setups;
}

/**
 * The address a launchpad's contracts write for an asset on the chain: the zero address for the
 * chain's coin, or the ERC-20 token's address in checksum form. Undefined for an asset of another
 * chain or another kind.
 */
export function curveTokenOf(
  asset: AssetRef,
  on: Pick<CurveChainSetup, "chain" | "nativeAsset">,
): Address | undefined {
  if (asset === on.nativeAsset) {
    return zeroAddress;
  }
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const token = parseEvmAddress(assetReference);
  const isToken = chain === on.chain && assetNamespace === "erc20" && token.ok;
  return isToken && token.value !== zeroAddress ? token.value : undefined;
}

/** The asset an address of a launchpad's contracts names on the chain. */
export function curveAssetOf(
  token: Address,
  on: Pick<CurveChainSetup, "chain" | "nativeAsset">,
): AssetRef {
  return token === zeroAddress
    ? on.nativeAsset
    : assetRefSchema.parse(`${on.chain}/erc20:${token}`);
}

/**
 * The side of a curve trade: a buy spends the coin or a quote token the launchpad serves on
 * another token; a sale is the reverse. Two quote assets, two tokens neither of which is one, or
 * an asset the chain's curves cannot name, are no curve trade: undefined.
 */
export function curveSideOf(
  trade: { readonly amountIn: Amount; readonly assetOut: AssetRef },
  on: CurveChainSetup,
): CurveSide | undefined {
  const inputToken = curveTokenOf(trade.amountIn.asset, on);
  const outputToken = curveTokenOf(trade.assetOut, on);
  if (inputToken === undefined || outputToken === undefined || inputToken === outputToken) {
    return undefined;
  }
  const isQuote = (token: Address) => token === zeroAddress || on.quoteTokens.has(token);
  const pair = { inputToken, outputToken };
  if (isQuote(inputToken) && !isQuote(outputToken)) {
    return { side: "buy", token: outputToken, quote: inputToken, ...pair };
  }
  return isQuote(outputToken) && !isQuote(inputToken)
    ? { side: "sell", token: inputToken, quote: outputToken, ...pair }
    : undefined;
}
