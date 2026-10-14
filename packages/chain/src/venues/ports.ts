import type { Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { TxDraft } from "../transaction.js";
import type { BuildRequest } from "./build-request.js";
import type { CurveHolding, CurveRequest } from "./curve-holding.js";
import type { DecodedEffect } from "./decoded-effect.js";
import type { PriceRead, PriceReadRequest } from "./price-read.js";
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

/** Tells whether a launchpad holds a token on its bonding curve. */
export interface CurveReader {
  /**
   * Whether the token is on the launchpad's curve now, read from the launchpad's own contracts at
   * the latest block, and the asset the curve trades it against. A token the launchpad never
   * launched, or one that graduated to the pools, is `{ onCurve: false }`. A launchpad that cannot
   * read its contracts throws. Rejects with the signal's reason once the signal aborts.
   */
  curve(request: CurveRequest, options: { readonly signal: AbortSignal }): Promise<CurveHolding>;
}

/** Names the wallets a launchpad's own contracts treat apart from every other buyer of a token. */
export interface InsiderReader {
  /**
   * The wallets the launchpad's contracts favor on a token it launched, such as the ones its launch
   * exempted from the launch-window tax, read from its own contracts and the launch's own
   * transaction: accounts of the token's chain, each once. A token it did not launch has none. A
   * launchpad that cannot read them throws. Rejects with the signal's reason once it aborts.
   */
  insiders(
    request: CurveRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly AccountRef[]>;
}

/** Tells the price watcher how to price a token from the venue's own contracts or pools. */
export interface PriceReader {
  /**
   * The reads that price the token each block, and the step that turns their answers into its
   * price. A token the venue cannot price, such as one it never launched or one off its curve, is
   * `no_price_read`. A venue that cannot answer throws. Rejects with the signal's reason once the
   * signal aborts.
   */
  priceRead(
    request: PriceReadRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<PriceRead, "no_price_read">>;
}
