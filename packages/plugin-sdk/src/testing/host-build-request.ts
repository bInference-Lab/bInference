import type { BuildRequest, QuoteRequest, VenueQuote } from "@binference/chain";

/**
 * What the venue host asks a venue to build after its quote: the deadline given, and a minimum
 * out that keeps `keepBps` of the quote (9,950 unless given), rounded up as the host rounds.
 */
export function hostBuildRequest(
  request: QuoteRequest,
  quote: VenueQuote,
  terms: { readonly deadlineMs: number; readonly keepBps?: bigint },
): BuildRequest {
  const expected = quote.expectedOut.base;
  const keepBps = terms.keepBps ?? 9_950n;
  return {
    ...request,
    quote,
    minOut: { asset: request.assetOut, base: (expected * keepBps + 9_999n) / 10_000n },
    deadlineMs: terms.deadlineMs,
  };
}
