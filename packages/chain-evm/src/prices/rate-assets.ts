import type { AssetRef, ChainDefinition, RatePriceDefinition } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type Address, concatHex, encodeAbiParameters, type Hex, toFunctionSelector } from "viem";
import { z } from "zod";
import { erc20AssetRef, evmChainOf } from "../evm-chain.js";
import { priceEntryAddress, priceEntryToken } from "./feed-assets.js";

/** A token priced at its chain's coin's price times the rate its own contract reads. */
export interface RateAsset {
  readonly asset: AssetRef;
  /** The chain's coin, whose price the rate multiplies. */
  readonly coin: AssetRef;
  /** One whole token in its base units, the amount the rate converts. */
  readonly unit: bigint;
  /** One whole coin in its base units, the scale the bounds are read against. */
  readonly coinUnit: bigint;
  /** The contract that converts the token to the coin and answers `paused()`. */
  readonly converter: Address;
  /** The call data converting one whole token: `convertFunction(unit)`. */
  readonly convertCall: Hex;
  readonly minRateBps: number;
  readonly maxRateBps: number;
  /** The Chainlink feed of the same rate, which the contract's rate must stay close to. */
  readonly checkFeed: {
    readonly address: Address;
    /** One whole coin in the feed's answer: 10 to the feed's decimals. */
    readonly feedUnit: bigint;
    readonly heartbeatSeconds: number;
    readonly maxGapBps: number;
  };
}

// A chain's feed proxies are its contracts under this venue.
const feedVenue = "chainlink";
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const positiveSchema = z.int().positive();
const decimalsSchema = z.int().min(0).max(36);

function refuse(definition: ChainDefinition, item: RatePriceDefinition): BinferenceError {
  return new BinferenceError({
    code: "chain.bad_price_feeds",
    message: `The ${definition.key} rate price of ${item.symbol} is malformed.`,
    details: { chain: definition.key, name: item.symbol },
  });
}

// A function name, bounds and a feed a start can read: a positive floor below the ceiling, the
// feed's decimals, a heartbeat and a gap above zero.
function isWellFormed(item: RatePriceDefinition): boolean {
  const { minRateBps, maxRateBps, checkFeed } = item;
  return (
    identifier.test(item.convertFunction) &&
    positiveSchema.safeParse(minRateBps).success &&
    positiveSchema.safeParse(maxRateBps).success &&
    minRateBps < maxRateBps &&
    decimalsSchema.safeParse(checkFeed.decimals).success &&
    positiveSchema.safeParse(checkFeed.heartbeatSeconds).success &&
    positiveSchema.safeParse(checkFeed.maxGapBps).success
  );
}

function contractOf(definition: ChainDefinition, venue: string, name: string): Address {
  const contract = definition.contracts.find(
    (entry) => entry.venue === venue && entry.name === name,
  );
  return priceEntryAddress(definition, contract, name);
}

/**
 * The tokens a chain's rate prices value (decision 0328), read from its registry definition: each
 * token at the coin's price times what its converting contract answers for one whole token,
 * guarded by its Chainlink feed of the same rate. A token, contract or feed the definition does
 * not name, a function name that is not one, bounds whose floor is not positive and below their
 * ceiling, or a feed without decimals, heartbeat or gap are a `chain.bad_price_feeds` fault, so a
 * start never runs on a rate it cannot read.
 */
export function rateAssetsOf(
  definition: ChainDefinition,
  rates: readonly RatePriceDefinition[],
): readonly RateAsset[] {
  const chain = evmChainOf(definition);
  return rates.map((item): RateAsset => {
    if (!isWellFormed(item)) {
      throw refuse(definition, item);
    }
    const token = priceEntryToken(definition, item.symbol);
    const unit = 10n ** BigInt(token.decimals);
    const { checkFeed } = item;
    return {
      asset: erc20AssetRef(chain, token.address),
      coin: chain.nativeAsset,
      unit,
      coinUnit: 10n ** BigInt(chain.nativeDecimals),
      converter: contractOf(definition, item.venue, item.contract),
      convertCall: concatHex([
        toFunctionSelector(`function ${item.convertFunction}(uint256)`),
        encodeAbiParameters([{ type: "uint256" }], [unit]),
      ]),
      minRateBps: item.minRateBps,
      maxRateBps: item.maxRateBps,
      checkFeed: {
        address: contractOf(definition, feedVenue, checkFeed.contract),
        feedUnit: 10n ** BigInt(checkFeed.decimals),
        heartbeatSeconds: checkFeed.heartbeatSeconds,
        maxGapBps: checkFeed.maxGapBps,
      },
    };
  });
}
