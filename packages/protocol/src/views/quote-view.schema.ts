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
}

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
});
