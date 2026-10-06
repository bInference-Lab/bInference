import type { Result } from "@binference/core";
import type { TxDraft } from "../transaction.js";
import type { BuildRequest } from "./build-request.js";
import type { DecodedEffect } from "./decoded-effect.js";
import type { QuoteRequest, VenueQuote } from "./venue-quote.js";

/** Quotes a trade on one venue. */
export interface Quoter {
  /**
   * Quotes spending exactly the request's input. A pair the venue cannot route is `no_route`; a
   * venue that cannot answer throws. Rejects with the signal's reason once the signal aborts.
   */
  quote(
    request: QuoteRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<VenueQuote, "no_route">>;
}

/** Builds the transactions of a quoted trade on one venue. */
export interface TxBuilder {
  /**
   * Builds the trade's steps in order, each from the request's wallet: an exact token approval
   * when the venue needs one, then the trade call. A venue that cannot build throws. Rejects with
   * the signal's reason once the signal aborts.
   */
  build(
    request: BuildRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly TxDraft[]>;
}

/** Reads back what a venue's trade call does. */
export interface TxDecoder {
  /**
   * Decodes a trade call the venue builds into its effect, from the draft's bytes alone. A draft
   * that is not one of the venue's trade calls is `unknown_call`, never a guess.
   */
  decode(draft: TxDraft): Result<DecodedEffect, "unknown_call">;
}
