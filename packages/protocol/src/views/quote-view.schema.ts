import { type Amount, amountSchema } from "@binference/chain";
import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";

/** One venue's share of a route. */
export interface RouteLeg {
  readonly venue: string;
  readonly shareBps: Bps;
}

/**
 * Where a `buy` or a `sell` trades (spec 6, section 5): on the bonding curve of the launchpad that
 * holds the token, or in the pools, through the aggregators.
 */
export type TradePlace =
  | { readonly kind: "curve"; readonly launchpad: string }
  | { readonly kind: "pools" };

/** A venue quote: the route, what goes in, what comes out at worst, its impact and gas. */
export interface QuoteView {
  readonly route: readonly RouteLeg[];
  readonly amountIn: Amount;
  readonly expectedOut: Amount;
  readonly minOut: Amount;
  readonly priceImpactBps: Bps;
  readonly gas: Amount;
  readonly quotedAt: number;
  readonly expiresAt: number;
  /** The place a `buy` or a `sell` trades at, which the engine chose; a swap has none. */
  readonly place?: TradePlace;
}

// A launchpad is named by its venue id.
const tradePlaceSchema: z.ZodType<TradePlace> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("curve"), launchpad: venueIdSchema }),
  z.object({ kind: z.literal("pools") }),
]);

/** Parses a quote view. */
export const quoteViewSchema: z.ZodType<QuoteView> = z.object({
  route: z.array(z.object({ venue: venueIdSchema, shareBps: bpsSchema })),
  amountIn: amountSchema,
  expectedOut: amountSchema,
  minOut: amountSchema,
  priceImpactBps: bpsSchema,
  gas: amountSchema,
  quotedAt: epochMsSchema,
  expiresAt: epochMsSchema,
  place: tradePlaceSchema.exactOptional(),
});
