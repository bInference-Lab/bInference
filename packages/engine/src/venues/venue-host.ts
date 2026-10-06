import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
  assetRefSchema,
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
import { type HostedVenue, hostVenues } from "./hosted-venue.js";
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
}

/** Why the host refused a trade: a check reason of spec 6 that `quote_failed` carries. */
export type VenueFailure = Exclude<QuoteFailure, "price_impact">;

/** The host's refusal. `mismatch` names the failed check of a `decode_mismatch`. */
export interface VenueRefused extends Err<VenueFailure> {
  readonly mismatch?: BuildMismatch;
}

/** What the host answers for a trade. */
export type VenueOutcome = Ok<TradePlan> | VenueRefused;

/**
 * The venue host: step 3 of the money path (ARCHITECTURE.md section 7). It runs reviewed venue
 * code inside the engine, sets the terms of every trade itself, and refuses whatever a venue
 * builds that it cannot read or that breaks those terms.
 */
export interface VenueHost {
  /**
   * Quotes a trade on its venue, builds its steps and checks each one. A venue that throws, times
   * out or answers outside its types is `venue_down`; a pair it cannot route, `no_route`; a step
   * that breaks a check, `decode_mismatch`. Rejects with the signal's reason once it aborts.
   */
  plan(trade: VenueTrade, options: { readonly signal: AbortSignal }): Promise<VenueOutcome>;
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

function nativeAssetOf(chain: RegisteredChain): AssetRef {
  const { assetNamespace, assetReference } = chain.definition.nativeAsset;
  return assetRefSchema.parse(`${chain.ref}/${assetNamespace}:${assetReference}`);
}

function frozenAmount(amount: Amount): Amount {
  return Object.freeze({ asset: amount.asset, base: amount.base });
}

// What the host hands a venue is frozen, so venue code cannot move the terms it is checked by.
function frozenQuote(quote: VenueQuote): VenueQuote {
  return Object.freeze({ ...quote, expectedOut: frozenAmount(quote.expectedOut) });
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

interface BuildInput {
  readonly context: TradeContext;
  readonly quote: VenueQuote;
  readonly quotedAtMs: number;
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
    family: chain.family,
  };
}

// The host sets the terms the venue builds with, then reads back and checks what it built.
async function buildPlan(input: BuildInput, call: VenueCallOptions): Promise<VenueOutcome> {
  const { context, quote, quotedAtMs } = input;
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
  return ok({ venue: trade.venue, quote, terms, steps: steps.value });
}

/**
 * Creates the {@link VenueHost}. Every venue's declaration is checked against the chain registry
 * now: a venue that declares a chain or a contract the registry does not hold is a fault.
 */
export function createVenueHost(options: VenueHostOptions): VenueHost {
  const venues = hostVenues(options.venues, options.chains);
  return {
    async plan(trade, { signal }) {
      signal.throwIfAborted();
      const context = contextOf(trade, venues, options.chains);
      if (!context.ok) {
        return refuse(context.error);
      }
      const call = { clock: options.clock, signal, timeoutMs: options.callTimeoutMs };
      const quote = await quoteOf(context.value, call);
      if (!quote.ok) {
        return quote;
      }
      const quotedAtMs = options.clock.now();
      return await buildPlan({ context: context.value, quote: quote.value, quotedAtMs }, call);
    },
  };
}
