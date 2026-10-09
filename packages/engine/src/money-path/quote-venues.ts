import { type Clock, createDeadline } from "@binference/core";
import type { QuoteOutcome, VenueHost } from "../venues/venue-host.js";
import type { SwapTrade } from "./swap-trade.js";

/** What every venue is asked with. */
export interface QuoteVenuesOptions {
  readonly host: VenueHost;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

/** A venue that has not quoted within this long is skipped for the trade (decision 0107). */
export const quoteWaitMs = 3_000;

async function quoteWithin(
  trade: SwapTrade["trade"],
  options: QuoteVenuesOptions,
): Promise<QuoteOutcome> {
  const { clock, signal } = options;
  const deadline = createDeadline({ clock, signal, timeoutMs: quoteWaitMs });
  try {
    return await options.host.quote(trade, { signal: deadline.signal });
  } catch {
    signal.throwIfAborted();
    // The host rejects only once its signal aborts: here, the wait ran out.
    return { ok: false, error: "venue_down" };
  } finally {
    deadline.clear();
  }
}

/**
 * Asks every venue the agent allows for a quote of the swap, all at once, and gives their answers
 * in the agent's venue order. A venue that has not answered within {@link quoteWaitMs} is skipped
 * as `venue_down`; an abort of the caller's signal rejects with its reason.
 */
export async function quoteVenues(
  swap: SwapTrade,
  options: QuoteVenuesOptions,
): Promise<readonly QuoteOutcome[]> {
  return Promise.all(
    swap.venues.map(async (venue) => quoteWithin({ ...swap.trade, venue }, options)),
  );
}

/**
 * The quote the policy prices the trade from: the first venue's in the agent's order that quoted,
 * or, when none did, the first venue's refusal.
 */
export function firstQuoteOf(quotes: readonly QuoteOutcome[]): QuoteOutcome {
  return quotes.find((quote) => quote.ok) ?? quotes[0] ?? { ok: false, error: "venue_down" };
}
