import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import type { AssetRef } from "../caip/asset-ref.js";

/** What the venue host asks a venue to quote: spend exactly `amountIn` on `assetOut`. */
export interface QuoteRequest {
  /** The agent's own wallet, which pays and receives. Its chain is the trade's chain. */
  readonly wallet: AccountRef;
  /** The exact input, in base units. */
  readonly amountIn: Amount;
  /** The asset the trade buys. */
  readonly assetOut: AssetRef;
  /**
   * The venue's declared contracts on the wallet's chain, by their names in the chain registry,
   * and, for a token a launchpad holds, the contracts of its launch by their declared names. A
   * venue calls only these; the host refuses a transaction to any other contract.
   */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/** What the hooked pools of one maker keep of a trade along a route. */
export interface PoolHookFee {
  /** Who made the pools, as a card names them, such as Genius.fun. */
  readonly maker: string;
  /**
   * The most the maker's hooks keep of the trade along any one path of the route: the sum of the
   * fees of its hooked pools on that path, never below what they keep.
   */
  readonly feeBps: Bps;
  /** The maker's hooks the route passes, each once, which may take their share as a transfer. */
  readonly hooks: readonly AccountRef[];
}

/** A {@link PoolHookFee} as JSON carries it. */
export interface PoolHookFeeWire {
  readonly maker: string;
  readonly feeBps: number;
  readonly hooks: readonly string[];
}

/** A venue's quote for a {@link QuoteRequest}. */
export interface VenueQuote {
  /** What the input buys at the quoted price, in base units of the asset out. */
  readonly expectedOut: Amount;
  /**
   * The share of the input's value the route loses, rounded up. An impact the venue cannot tell
   * is the whole input, 10,000 bp, so an agent's maximum below that refuses the quote.
   */
  readonly priceImpactBps: Bps;
  /**
   * The token tax the venue's own contract takes on this trade, which no token transfer shows,
   * such as a launchpad's tax on its curve, taken in the asset the curve trades against. The risk
   * check counts it as the leg's tax, so the quote's price impact leaves it out. Left out, the
   * venue takes none; a tax the token takes on its transfers is the round trip's to measure.
   */
  readonly taxBps?: Bps;
  /**
   * The part of `taxBps` the venue's contract takes on this buy because its token's launch is
   * still young, such as a launchpad's snipe tax in the seconds after a launch, for the request's
   * wallet at the latest block. It falls as the launch ages. The risk step refuses a buy whose
   * snipe tax is above the agent's maximum tax. Left out, none.
   */
  readonly snipeTaxBps?: Bps;
  /**
   * What the pool hooks on the route keep of the trade, by who made their pools, as the chain's
   * hook allowlist states each hook's fee, such as a launchpad's hook on its graduated pools
   * (decision 0214). The expected output already holds it back. Left out, the route passes no
   * hook that keeps a share.
   */
  readonly hookFees?: readonly PoolHookFee[];
  /**
   * The venue's own record of the route it quoted, given back to its builder. The host stores it
   * and never reads it.
   */
  readonly route?: string;
}

/** A {@link VenueQuote} as JSON carries it. */
export interface VenueQuoteWire {
  readonly expectedOut: AmountWire;
  readonly priceImpactBps: number;
  readonly taxBps?: number;
  readonly snipeTaxBps?: number;
  readonly hookFees?: readonly PoolHookFeeWire[];
  readonly route?: string;
}

// A snipe tax is a part of the quote's tax, never more than all of it.
function isPartOfTax(quote: Pick<VenueQuote, "taxBps" | "snipeTaxBps">): boolean {
  return quote.snipeTaxBps === undefined || quote.snipeTaxBps <= (quote.taxBps ?? 0);
}

// A maker's name as a card shows it: a short name of letters, digits, spaces, dots and dashes.
const makerSchema = z
  .string()
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 .-]*$/u);

const isEachOnce = (items: readonly string[]): boolean => new Set(items).size === items.length;

const poolHookFeeSchema: z.ZodType<PoolHookFee, PoolHookFeeWire> = z.strictObject({
  maker: makerSchema,
  feeBps: bpsSchema,
  hooks: z.array(accountRefSchema).min(1).refine(isEachOnce, "A hook is named once."),
});

const makersOnce = (fees: readonly PoolHookFee[]): boolean =>
  isEachOnce(fees.map((fee) => fee.maker));

const hookFeesSchema = z
  .array(poolHookFeeSchema)
  .min(1)
  .refine(makersOnce, "A maker is named once.");

/**
 * Decodes a venue quote from JSON, and encodes it back with `z.encode`. A snipe tax above the
 * quote's tax is refused.
 */
export const venueQuoteSchema: z.ZodType<VenueQuote, VenueQuoteWire> = z
  .strictObject({
    expectedOut: amountSchema,
    priceImpactBps: bpsSchema,
    taxBps: bpsSchema.exactOptional(),
    snipeTaxBps: bpsSchema.exactOptional(),
    hookFees: hookFeesSchema.exactOptional(),
    route: z.string().exactOptional(),
  })
  .refine(isPartOfTax, { message: "A snipe tax is part of the quote's tax." });
