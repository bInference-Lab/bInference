import type { Amount } from "../amount.js";
import type { QuoteRequest, VenueQuote } from "./venue-quote.js";

/**
 * What the venue host asks a venue to build, after the quote. The host sets the economic terms:
 * the call must spend exactly `amountIn`, pay its output to `wallet`, revert below `minOut` and
 * revert after `deadlineMs`. The host decodes what the venue built and refuses any other terms.
 */
export interface BuildRequest extends QuoteRequest {
  /** The quote the venue gave for this request. */
  readonly quote: VenueQuote;
  /** The least the call may return, in base units of the asset out. */
  readonly minOut: Amount;
  /** Epoch milliseconds; the call must revert after it. */
  readonly deadlineMs: number;
}
