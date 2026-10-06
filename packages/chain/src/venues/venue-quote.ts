import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
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
   * The venue's declared contracts on the wallet's chain, by their names in the chain registry.
   * A venue calls only these; the host refuses a transaction to any other contract.
   */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/** A venue's quote for a {@link QuoteRequest}. */
export interface VenueQuote {
  /** What the input buys at the quoted price, in base units of the asset out. */
  readonly expectedOut: Amount;
  readonly priceImpactBps: Bps;
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
  readonly route?: string;
}

/** Decodes a venue quote from JSON, and encodes it back with `z.encode`. */
export const venueQuoteSchema: z.ZodType<VenueQuote, VenueQuoteWire> = z.strictObject({
  expectedOut: amountSchema,
  priceImpactBps: bpsSchema,
  route: z.string().exactOptional(),
});
