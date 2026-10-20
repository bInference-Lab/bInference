import type { JsonValue, Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { TxDraft } from "../transaction.js";
import type { BuildRequest } from "./build-request.js";
import type { CurveHolding, CurveRequest } from "./curve-holding.js";
import type { DecodedEffect } from "./decoded-effect.js";
import type { LaunchesFound, LaunchLogsRequest } from "./launch-logs.js";
import type { LaunchOption, LaunchOptionValue } from "./launch-option.js";
import type {
  DecodedLaunch,
  LaunchBuild,
  LaunchBuildRequest,
  LaunchPin,
  LaunchPinRequest,
  LaunchQuote,
  LaunchTerms,
  PinStatus,
} from "./launch-terms.js";
import type { LaunchWordLimits, LaunchWords } from "./launch-words.js";
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

/**
 * Tells the launch feed which tokens a launchpad created: the events its launches write, and how
 * to read a launch from them. The feed reads the declared events of every launchpad in one log
 * query a read, from any contract, so the launchpad checks who wrote each log.
 */
export interface LaunchReader {
  /**
   * The events the feed reads for the launchpad, each once, as its chain family names an event: an
   * EVM event's topic0, as lowercase hex.
   */
  readonly launchEvents: readonly string[];
  /**
   * The launches and curve changes one transaction's logs tell, from those logs alone: a create
   * event only from one of the launchpad's own contracts, and what each launch's other logs add,
   * only from the contracts that launch made or the launchpad's own. A transaction with none
   * answers none. Logs outside their shape are passed over, never a throw.
   */
  readLaunches(request: LaunchLogsRequest): LaunchesFound;
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

/**
 * Launches a token on a launchpad: quotes it from the launchpad's contracts, uploads and pins its
 * words and picture through the launchpad's own API, builds its create call with the first buy,
 * and decodes that call back. It never signs or sends, and never reads the picture's gateway
 * address: a gateway read before the pin can break the picture for good. A launchpad with no API
 * for them leaves out `pin` and `pinStatus` together: it uploads nothing, and either its create
 * call names the picture as a `link` setting the owner hosts, which nothing reads (decision 0276),
 * or it writes the picture's bytes into its create call (`pictureBytesFor`, decision 0279).
 */
export interface Launcher {
  /** The settings the launchpad takes beyond those every launch has, such as a tax. */
  readonly launchOptions: readonly LaunchOption[];
  /**
   * The create call's first buy carries no minimum out: it runs inside the call that makes the
   * token, before any other trade can reach the new curve, and the launchpad's contracts take no
   * minimum for it. The decoder then reads its minimum as 0, and the host accepts it; the
   * simulation before the card still holds the first buy to its minimum (decision 0270). Left
   * out, every first buy carries its minimum in the create call.
   */
  readonly noFirstBuyMin?: boolean;
  /**
   * The most bytes the launchpad's create call takes for a launch's name, symbol, description and
   * each link, which it writes on chain: the engine refuses a launch over one before anything is
   * stored. Left out, the launchpad takes the words every request may give.
   */
  readonly wordLimits?: LaunchWordLimits;
  /**
   * The launchpad writes the owner's picture into its create call (decision 0279): the most bytes
   * of a picture the call takes beside these words. Such a launcher uploads nothing and has no
   * pin; its build gets the picture's bytes and its decoder names the picture it writes. Left
   * out, the launchpad writes no picture into its create call.
   */
  readonly pictureBytesFor?: (words: LaunchWords) => number;
  /**
   * Whether a launch's settings go together as the launchpad takes them (decision 0280), such as
   * a fee recipient only while holder rewards are off: each is already checked against its
   * declaration. A launch whose settings do not is refused before anything is stored. Left out,
   * any settings that pass their declarations go together.
   */
  readonly checkOptions?: (options: Readonly<Record<string, LaunchOptionValue>>) => boolean;
  /**
   * The warnings every card of the launchpad's launches shows (decision 0281), by name in
   * camelCase, each with the message `launch.warn.<name>` in every language, such as one about
   * the launchpad's own terms. Left out, none.
   */
  readonly cardWarnings?: readonly string[];
  /**
   * The launch fee and the first buy's output, read from the launchpad's contracts at the latest
   * block, nothing uploaded. A pair the launchpad does not launch against is `no_route`; a
   * launchpad that cannot answer throws. Rejects with the signal's reason once it aborts.
   */
  quoteLaunch(
    terms: LaunchTerms,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LaunchQuote, "no_route">>;
  /**
   * Uploads the launch's words and picture and asks the launchpad to pin them, without waiting
   * for the pin. A launchpad that cannot take them throws. Rejects with the signal's reason once
   * it aborts.
   */
  readonly pin?: (
    request: LaunchPinRequest,
    options: { readonly signal: AbortSignal },
  ) => Promise<LaunchPin>;
  /**
   * Where the pin of an upload stands, as the launchpad reports it, from the handle `pin` gave. A
   * launchpad that cannot answer throws. Rejects with the signal's reason once it aborts.
   */
  readonly pinStatus?: (
    pin: JsonValue,
    options: { readonly signal: AbortSignal },
  ) => Promise<PinStatus>;
  /**
   * Builds the launch's steps from the launch wallet: an exact approval of the first buy's spend
   * when the launchpad needs one, then one create call that pays the quoted fee, names the
   * metadata address of an upload and, with a first buy, buys for the wallet no less than its minimum, or with
   * none when the launcher declares `noFirstBuyMin`. Every
   * step calls the launchpad's registry contracts. A launchpad that cannot build throws. Rejects
   * with the signal's reason once it aborts.
   */
  buildLaunch(
    request: LaunchBuildRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchBuild>;
  /**
   * Decodes a create call the launchpad builds into what it does, from the draft's bytes alone. A
   * draft that is not one of its create calls is `unknown_call`, never a guess.
   */
  decodeLaunch(draft: TxDraft): Result<DecodedLaunch, "unknown_call">;
}

/** A launcher that uploads and pins: it gives both `pin` and `pinStatus`. */
export type UploadingLauncher = Launcher & Required<Pick<Launcher, "pin" | "pinStatus">>;
