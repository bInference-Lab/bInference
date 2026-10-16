import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type ChainRegistry,
  type QuoteRequest,
  type RegisteredChain,
  type Venue,
  type VenueQuote,
  venueQuoteSchema,
} from "@binference/chain";
import { type Bps, type Clock, type Err, err, type Ok, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { QuoteTerms } from "../intents/intent-status.js";
import {
  type BuildMismatch,
  checkSteps,
  minOutFloor,
  type PlanStep,
  type TradeBounds,
} from "./build-checks.js";
import { callVenue, ownCopy, type VenueCallOptions } from "./call-venue.js";
import { frozenAmount, frozenQuote, nativeAssetOf } from "./host-terms.js";
import { type HostedVenue, hostVenues, launchCallsOf } from "./hosted-venue.js";
import { contractsWithLaunch, type LaunchContracts, tradeLaunchOf } from "./launch-contracts.js";
import { type CurveClaim, isLaunchpad, readCurves } from "./read-curves.js";
import { readInsiders } from "./read-insiders.js";
import { type HostedPriceRead, readPrices } from "./read-prices.js";
import { readSteps } from "./read-steps.js";

/** A resolved trade the host quotes and builds on one venue. */
export interface VenueTrade {
  /** The venue's id; the policy already checked that the agent may use it. */
  readonly venue: string;
  /** The agent's own wallet, which pays and receives. Its chain is the trade's chain. */
  readonly wallet: AccountRef;
  /** The exact input, in base units. */
  readonly amountIn: Amount;
  readonly assetOut: AssetRef;
  /** The slippage the policy allowed: the request's own, or the agent's maximum for the pair. */
  readonly maxSlippageBps: Bps;
}

/** A quoted and built trade whose every step passed the host's checks. */
export interface TradePlan {
  readonly venue: string;
  /** The host's copy of the venue's quote, with its route for a later build. */
  readonly quote: VenueQuote;
  /** What `quote_built` carries: when the venue quoted, and the minimum out the trade enforces. */
  readonly terms: QuoteTerms;
  /** The steps in order: at most one exact approval, then the trade call. */
  readonly steps: readonly PlanStep[];
  /**
   * The contracts of the traded token's launch the trade was quoted and built with, which the
   * risk step's test legs are built with too (decision 0212). Left out, registry contracts alone.
   */
  readonly launch?: LaunchContracts;
}

/** A trade the host quoted on its venue and has not built yet. */
export interface TradeQuote {
  readonly trade: VenueTrade;
  /** The host's copy of the venue's quote, which the venue builds the trade from. */
  readonly quote: VenueQuote;
  /** When the venue quoted: the trade call's deadline counts from here. */
  readonly quotedAtMs: number;
  /**
   * The contracts of the traded token's launch that the venue's curve read named when it quoted,
   * which the build may call too (decision 0212). Left out, registry contracts alone.
   */
  readonly launch?: LaunchContracts;
}

/** Why the host refused a trade: a check reason of spec 6 that `quote_failed` carries. */
export type VenueFailure = Extract<QuoteFailure, "no_route" | "venue_down" | "decode_mismatch">;

/** The host's refusal. `mismatch` names the failed check of a `decode_mismatch`. */
export interface VenueRefused extends Err<VenueFailure> {
  readonly mismatch?: BuildMismatch;
}

/** What the host answers for a trade. */
export type VenueOutcome = Ok<TradePlan> | VenueRefused;

/** What the host answers when it quotes a trade. */
export type QuoteOutcome = Ok<TradeQuote> | VenueRefused;

/**
 * The venue host: step 3 of the money path (ARCHITECTURE.md section 7). It runs reviewed venue
 * code inside the engine, sets the terms of every trade itself, and refuses whatever a venue
 * builds that it cannot read or that breaks those terms.
 */
export interface VenueHost {
  /**
   * Asks a trade's venue for a quote and builds nothing, so the policy can price the trade from
   * the quote before any step exists. A venue that throws, times out or answers outside its types
   * is `venue_down`; a pair it cannot route, `no_route`; a quote of another asset,
   * `decode_mismatch`. Rejects with the signal's reason once it aborts.
   */
  quote(trade: VenueTrade, options: { readonly signal: AbortSignal }): Promise<QuoteOutcome>;
  /**
   * Builds the steps of a trade it quoted and checks each one, with the terms it sets from that
   * quote. A venue that fails to build is `venue_down`; a step that breaks a check,
   * `decode_mismatch`. Rejects with the signal's reason once it aborts.
   */
  build(quoted: TradeQuote, options: { readonly signal: AbortSignal }): Promise<VenueOutcome>;
  /** Quotes a trade, then builds it: `quote` and `build` in one call, with their answers. */
  plan(trade: VenueTrade, options: { readonly signal: AbortSignal }): Promise<VenueOutcome>;
  /**
   * Asks every launchpad on the token's chain, all at once, whether the token is on its curve
   * now, and answers those that hold it, each with the asset its curve trades the token against
   * (spec 6, section 5). A launchpad that throws, times out or answers outside its types makes the
   * whole answer `venue_down`, since a token on a curve must never go to the pools. Rejects with
   * the signal's reason once it aborts.
   */
  curves(
    token: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly CurveClaim[], "venue_down">>;
  /**
   * How to price a token each block, for the price watcher: the reads of the launchpad that holds
   * it on its curve, else of the first other venue that declares one for it, checked and copied
   * (ARCHITECTURE.md section 9). A token no venue prices is `no_price_read`; a venue that throws,
   * times out or answers outside its types, when no other one priced the token, is `venue_down`.
   * Rejects with the signal's reason once it aborts.
   */
  priceRead(
    token: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<HostedPriceRead, "no_price_read" | "venue_down">>;
  /**
   * The wallets a venue's contracts favor on a token it launched, for the risk step: a launchpad
   * that names insiders is asked; any other venue names none. A launchpad that throws, times out
   * or answers anything but accounts of the token's chain, each once, is `venue_down`. Rejects
   * with the signal's reason once it aborts.
   */
  insiders(
    venue: string,
    token: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly AccountRef[], "venue_down">>;
  /** Whether the venue is a launchpad the host holds: one that reads its curve. */
  isLaunchpad(venue: string): boolean;
  /**
   * Whether the venue declares that its trade calls on the chain carry no deadline (decision
   * 0180). A venue the host does not hold, or a chain it does not serve, has none of its own.
   */
  hasNoDeadline(venue: string, chain: ChainRef): boolean;
  /**
   * Whether the venue declares contracts each launch has, on any chain (decision 0212): no wallet
   * ceiling can list them, so its live trades need a launch wallet of their own.
   */
  hasLaunchContracts(venue: string): boolean;
  /**
   * The JSON ABI entry of each call the venue declares on the contracts each launch has, on any
   * chain, or every hosted venue's when `venue` is absent: a launch wallet's ceiling must allow
   * each (decision 0218). None for a venue the host does not hold.
   */
  launchCalls(venue?: string): HostedVenue["launchCalls"];
}

/** What the host is made from. */
export interface VenueHostOptions {
  /** Every venue the engine may use; their declarations are checked against `chains` at once. */
  readonly venues: readonly Venue[];
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  /** How long one quote or build may take before the venue counts as down. */
  readonly callTimeoutMs: number;
}

/** Rule 5: a trade's card expires with its quote after 60 s, so no trade call outlives that. */
const maxDeadlineMs = 60_000;

const quoteAnswerSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: venueQuoteSchema }),
  z.strictObject({ ok: z.literal(false), error: z.literal("no_route") }),
]);

function refuse(error: VenueFailure, mismatch?: BuildMismatch): VenueRefused {
  return mismatch === undefined ? { ok: false, error } : { ok: false, error, mismatch };
}

/** The trade's venue, chain and contracts, and the request the venue quotes. */
interface TradeContext {
  readonly trade: VenueTrade;
  readonly hosted: HostedVenue;
  readonly chain: RegisteredChain;
  readonly request: QuoteRequest;
}

// A trade the host cannot run on its venue: unknown venue, or a chain or pair it does not serve.
function contextOf(
  trade: VenueTrade,
  venues: ReadonlyMap<string, HostedVenue>,
  chains: ChainRegistry,
): Result<TradeContext, VenueFailure> {
  const hosted = venues.get(trade.venue);
  if (hosted === undefined) {
    return err("venue_down");
  }
  const chainRef = accountRefParts(trade.wallet).chain;
  const chain = chains.get(chainRef);
  const contracts = hosted.contracts.get(chainRef);
  const assets = [trade.amountIn.asset, trade.assetOut];
  const isPair = assets.every((asset) => assetRefParts(asset).chain === chainRef);
  if (!chain.ok || contracts === undefined || !isPair || trade.amountIn.asset === trade.assetOut) {
    return err("no_route");
  }
  const request: QuoteRequest = Object.freeze({
    wallet: trade.wallet,
    amountIn: frozenAmount(trade.amountIn),
    assetOut: trade.assetOut,
    contracts,
  });
  return ok({ trade, hosted, chain: chain.value, request });
}

// The trade with a launch's contracts in its request, or `undefined` when the launch names a
// contract the venue does not declare as a launch's on the trade's chain.
function withLaunch(
  context: TradeContext,
  launch: LaunchContracts | undefined,
): TradeContext | undefined {
  const names = context.hosted.launchNames.get(context.chain.ref);
  const contracts = contractsWithLaunch(context.request.contracts, launch, names);
  return contracts === undefined
    ? undefined
    : { ...context, request: Object.freeze({ ...context.request, contracts }) };
}

async function quoteOf(
  { hosted, request }: TradeContext,
  call: VenueCallOptions,
): Promise<Ok<VenueQuote> | VenueRefused> {
  const answer = await callVenue(async (signal) => hosted.venue.quote(request, { signal }), call);
  const quote = answer.ok ? ownCopy(quoteAnswerSchema, answer.value) : undefined;
  if (quote === undefined) {
    return refuse("venue_down");
  }
  if (!quote.ok || quote.value.expectedOut.base === 0n) {
    return refuse("no_route");
  }
  return quote.value.expectedOut.asset === request.assetOut
    ? ok(frozenQuote(quote.value))
    : refuse("decode_mismatch", "quote_mismatch");
}

function boundsOf(context: TradeContext, minOut: Amount, deadlineMs: number): TradeBounds {
  const { trade, chain, request } = context;
  return {
    wallet: trade.wallet,
    amountIn: trade.amountIn,
    assetOut: trade.assetOut,
    nativeAsset: nativeAssetOf(chain),
    contracts: Object.values(request.contracts),
    minOutBase: minOut.base,
    latestDeadlineMs: deadlineMs,
    allowsNoDeadline: context.hosted.noDeadline.has(chain.ref),
    family: chain.family,
  };
}

// The host sets the terms the venue builds with, then reads back and checks what it built.
async function buildPlan(
  context: TradeContext,
  quoted: TradeQuote,
  call: VenueCallOptions,
): Promise<VenueOutcome> {
  const { quote, quotedAtMs } = quoted;
  const { trade, hosted, chain, request } = context;
  const minOut = frozenAmount({
    asset: trade.assetOut,
    base: minOutFloor(quote.expectedOut.base, trade.maxSlippageBps),
  });
  const deadlineMs = quotedAtMs + maxDeadlineMs;
  const buildRequest = Object.freeze({ ...request, quote, minOut, deadlineMs });
  const built = await callVenue(
    async (signal) => hosted.venue.build(buildRequest, { signal }),
    call,
  );
  if (!built.ok) {
    return refuse("venue_down");
  }
  const steps = readSteps(built.value, { family: chain.family, decoder: hosted.venue });
  if (!steps.ok) {
    return refuse("decode_mismatch", steps.error);
  }
  const checked = checkSteps(steps.value, boundsOf(context, minOut, deadlineMs));
  if (!checked.ok) {
    return refuse("decode_mismatch", checked.error);
  }
  const terms = { quotedAtMs, minOutBase: checked.value.minOut.base };
  const launch = quoted.launch === undefined ? {} : { launch: quoted.launch };
  return ok({ venue: trade.venue, quote, terms, steps: steps.value, ...launch });
}

/** What the host's quote and build share: its venues, its chains and its call options. */
interface HostParts {
  readonly venues: ReadonlyMap<string, HostedVenue>;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly callOf: (signal: AbortSignal) => VenueCallOptions;
}

// The quote of a trade, with its token's launch contracts when its venue declares such.
async function quoteTrade(
  parts: HostParts,
  trade: VenueTrade,
  signal: AbortSignal,
): Promise<QuoteOutcome> {
  const context = contextOf(trade, parts.venues, parts.chains);
  if (!context.ok) {
    return refuse(context.error);
  }
  const call = parts.callOf(signal);
  // Decision 0212: the token bought, then the token sold, never the chain's coin.
  const { hosted, chain } = context.value;
  const tokens = [trade.assetOut, trade.amountIn.asset].filter(
    (asset) => asset !== nativeAssetOf(chain),
  );
  const launch = await tradeLaunchOf(hosted, { chain: chain.ref, tokens }, call);
  const launched = launch.ok ? withLaunch(context.value, launch.value) : undefined;
  if (!launch.ok || launched === undefined) {
    return refuse("venue_down");
  }
  const quote = await quoteOf(launched, call);
  if (!quote.ok) {
    return quote;
  }
  const quotedAtMs = parts.clock.now();
  const named = launch.value === undefined ? {} : { launch: launch.value };
  return ok(Object.freeze({ trade, quote: quote.value, quotedAtMs, ...named }));
}

// The build of a quoted trade, with the launch contracts it was quoted with.
async function buildTrade(
  parts: HostParts,
  quoted: TradeQuote,
  signal: AbortSignal,
): Promise<VenueOutcome> {
  const context = contextOf(quoted.trade, parts.venues, parts.chains);
  if (!context.ok) {
    return refuse(context.error);
  }
  const launched = withLaunch(context.value, quoted.launch);
  return launched === undefined
    ? refuse("venue_down")
    : await buildPlan(launched, quoted, parts.callOf(signal));
}

/**
 * Creates the {@link VenueHost}. Every venue's declaration is checked against the chain registry
 * now: a venue that declares a chain or a contract the registry does not hold is a fault.
 */
export function createVenueHost(options: VenueHostOptions): VenueHost {
  const venues = hostVenues(options.venues, options.chains);
  const callOf = (signal: AbortSignal): VenueCallOptions => ({
    clock: options.clock,
    signal,
    timeoutMs: options.callTimeoutMs,
  });
  const parts: HostParts = { venues, chains: options.chains, clock: options.clock, callOf };
  const host: VenueHost = {
    async quote(trade, { signal }) {
      signal.throwIfAborted();
      return quoteTrade(parts, trade, signal);
    },
    async build(quoted, { signal }) {
      signal.throwIfAborted();
      return buildTrade(parts, quoted, signal);
    },
    async plan(trade, call) {
      const quoted = await host.quote(trade, call);
      return quoted.ok ? await host.build(quoted.value, call) : quoted;
    },
    async curves(token, { signal }) {
      signal.throwIfAborted();
      return readCurves(token, venues, callOf(signal));
    },
    async priceRead(token, { signal }) {
      signal.throwIfAborted();
      return readPrices(token, venues, callOf(signal));
    },
    async insiders(venue, token, { signal }) {
      signal.throwIfAborted();
      return readInsiders(venues.get(venue), token, callOf(signal));
    },
    isLaunchpad(venue) {
      const hosted = venues.get(venue);
      return hosted !== undefined && isLaunchpad(hosted.venue);
    },
    hasNoDeadline(venue, chain) {
      return venues.get(venue)?.noDeadline.has(chain) === true;
    },
    hasLaunchContracts(venue) {
      const names = [...(venues.get(venue)?.launchNames.values() ?? [])];
      return names.some((declared) => declared.size > 0);
    },
    launchCalls: (venue) => launchCallsOf(venues, venue),
  };
  return host;
}
