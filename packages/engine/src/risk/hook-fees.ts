import type { AccountRef, VenueQuote } from "@binference/chain";
import { type Bps, bpsPerWhole, bpsSchema } from "@binference/core";

/**
 * The pool hooks a quote's route passes, which may take their fee as a transfer of the token
 * (decision 0215): every maker's, each once.
 */
export function routeHooksOf(quote: VenueQuote): readonly AccountRef[] {
  return [...new Set((quote.hookFees ?? []).flatMap((fee) => fee.hooks))];
}

/**
 * What a quote's route says its pool hooks keep of the trade: every maker's fee added up, at most
 * the whole trade. Left out, the route passes no hook that keeps a share.
 */
export function routeHookFeeBps(quote: VenueQuote): Bps | undefined {
  const fees = quote.hookFees ?? [];
  const sum = fees.reduce((total, fee) => total + fee.feeBps, 0);
  return fees.length === 0 ? undefined : bpsSchema.parse(Math.min(sum, bpsPerWhole));
}
