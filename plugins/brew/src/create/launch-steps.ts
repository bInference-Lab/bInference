import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type Amount,
  BinferenceError,
  type LaunchTerms,
  type TxDraft,
  type UsdPrice,
} from "@binference/plugin-sdk";
import { encodeEvmApproval, encodeEvmDraft, parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address, Hex } from "viem";
import type { BrewPair } from "../brew-options.js";
import { quoteTokenOf } from "../brew-setups.js";
import { type LaunchParams, launchCallData } from "../contracts/launch-call.js";
import type { LaunchChain, LaunchParts } from "./launch-parts.js";

/** Every Brew token's supply: 1,000,000,000 with 18 decimals, as Brew's docs and site launch it. */
export const tokenSupply: bigint = 10n ** 27n;

/** Every Brew launch's pool fee tier, 1%, and the PancakeSwap V3 tick spacing it has. */
export const poolFee = 10_000;
export const tickSpacing = 200;

/** A launch the venue can make: its chain, its pair, the token its pool holds, the contracts. */
export interface PlacedLaunch {
  readonly chain: LaunchChain;
  readonly pair: BrewPair;
  readonly quoteToken: Address;
  readonly factory: Address;
  readonly distributorFactory: Address;
}

function refuse(code: string, message: string): BinferenceError {
  return new BinferenceError({ code: `brew.${code}`, message });
}

/** The address of an account of an EVM chain. */
export function addressOf(account: AccountRef): Address {
  const address = parseEvmAddress(accountRefParts(account).address);
  if (!address.ok) {
    throw refuse("bad_launch", "A launch names an account that is no EVM address.");
  }
  return address.value;
}

/**
 * Where a launch's terms place it: a chain the venue launches on, a pair it takes, and the
 * factory and distributor factory among its contracts; anything else: undefined.
 */
export function placeOf(terms: LaunchTerms, parts: LaunchParts): PlacedLaunch | undefined {
  const chain = parts.chains.get(accountRefParts(terms.wallet).chain);
  const pair = chain?.pairs.get(terms.pair);
  const quoteToken = chain === undefined ? undefined : quoteTokenOf(terms.pair, chain.setup);
  const factory = terms.contracts["factory"];
  const distributorFactory = terms.contracts["distributor-factory"];
  if (
    chain === undefined ||
    pair === undefined ||
    quoteToken === undefined ||
    factory === undefined ||
    distributorFactory === undefined
  ) {
    return undefined;
  }
  return {
    chain,
    pair,
    quoteToken,
    factory: addressOf(factory),
    distributorFactory: addressOf(distributorFactory),
  };
}

/** A first buy that spends another asset than the pair is a fault of the caller. */
export function checkFirstBuy(terms: LaunchTerms): void {
  if (terms.firstBuy !== undefined && terms.firstBuy.asset !== terms.pair) {
    throw refuse(
      "bad_launch",
      "A Brew launch's first buy spends the asset its token trades against.",
    );
  }
}

// The start at $5,000 of the pair at binference's price: base units = micro-dollars over price.
const startUsdMicros = 5_000_000_000n;

/**
 * The market cap a launch starts at when the owner sets none (decision 0283): the pair's fixed
 * start, else $5,000 at binference's USD price of the pair, rounded down. A pair with neither is
 * `undefined`.
 */
export function defaultStartOf(pair: BrewPair, price: UsdPrice | undefined): bigint | undefined {
  if (pair.startBase !== undefined) {
    return pair.startBase;
  }
  if (price === undefined || price.numerator <= 0n || price.denominator <= 0n) {
    return undefined;
  }
  const base = (startUsdMicros * price.denominator) / price.numerator;
  return base > 0n ? base : undefined;
}

/** What a launch's create call writes beyond its terms. */
export interface LaunchWrite {
  readonly fee: bigint;
  readonly metadataURI: string;
  readonly initialTick: number;
  readonly feeRecipient: Address;
  readonly salt: Hex;
  /** The least of the new token the first buy takes; with a first buy alone. */
  readonly minimum?: bigint;
}

/** The parameters of the launch's `launch` call: its words, its pool and its first buy. */
function launchParamsOf(
  terms: LaunchTerms,
  placed: PlacedLaunch,
  write: LaunchWrite,
): LaunchParams {
  const wallet = addressOf(terms.wallet);
  return {
    name: terms.name,
    symbol: terms.symbol,
    metadataURI: write.metadataURI,
    totalSupply: tokenSupply,
    quoteToken: placed.quoteToken,
    fee: poolFee,
    initialTick: write.initialTick,
    positions: [],
    creatorFeeRecipient: write.feeRecipient,
    initialBuyQuoteAmount: terms.firstBuy?.base ?? 0n,
    initialBuyMinTokensOut: write.minimum ?? 0n,
    initialBuyRecipient: wallet,
    salt: write.salt,
    maxLaunchFeeWei: write.fee,
  };
}

const isCoinPair = (terms: LaunchTerms, placed: PlacedLaunch): boolean =>
  terms.pair === placed.chain.setup.nativeAsset;

/**
 * A launch's steps from its wallet: an exact approval of the factory for a token first buy, then
 * one `launch` call, whose value is the launch fee and a coin first buy.
 */
export function launchStepsOf(
  terms: LaunchTerms,
  placed: PlacedLaunch,
  write: LaunchWrite,
): readonly TxDraft[] {
  const { firstBuy } = terms;
  const coinSpend = isCoinPair(terms, placed) ? (firstBuy?.base ?? 0n) : 0n;
  const create = encodeEvmDraft({
    from: terms.wallet,
    to: accountRefSchema.parse(`${accountRefParts(terms.wallet).chain}:${placed.factory}`),
    value: write.fee + coinSpend,
    data: launchCallData(launchParamsOf(terms, placed, write)),
  });
  if (firstBuy === undefined || isCoinPair(terms, placed)) {
    return [create];
  }
  const approval = encodeEvmApproval({
    wallet: terms.wallet,
    token: placed.quoteToken,
    spender: placed.factory,
    amountBase: firstBuy.base,
  });
  return [approval, create];
}

/**
 * What the steps' sender holds for a dry run: the fee in the coin, and the first buy in the coin
 * beside it or in the pair, nothing more.
 */
export function heldFor(terms: LaunchTerms, placed: PlacedLaunch, fee: bigint): readonly Amount[] {
  const spend = terms.firstBuy;
  const asCoin = spend !== undefined && isCoinPair(terms, placed);
  const coin: Amount = {
    asset: placed.chain.setup.nativeAsset,
    base: asCoin ? fee + spend.base : fee,
  };
  return spend !== undefined && !asCoin ? [coin, spend] : [coin];
}
