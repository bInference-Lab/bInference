import { type AssetRef, type PriceSource, withQuotePrice } from "@binference/chain";
import { err, type Id, ok, type Ratio, type Result } from "@binference/core";
import type { SimulationFailure, QuoteFailure } from "../intents/intent-reason.js";
import type { PolicyPass, PolicyVerdict } from "../policy/check-policy.js";
import type { Simulator } from "../ports.js";
import type { SimulatedSteps } from "../simulation/simulated-steps.js";
import type { QuoteOutcome, TradeQuote, VenueHost } from "../venues/venue-host.js";
import { buildSwap, type PlannedSwap } from "./plan-swap.js";
import { gasInAssetOut, rankRoutes } from "./rank-routes.js";
import type { SwapTrade } from "./swap-trade.js";

/** What the best quote builds, simulates and weighs the venues' quotes with. */
export interface RouteChoiceOptions {
  readonly swap: SwapTrade;
  /** The intent the simulations run for, with its paper balances when it is a paper intent. */
  readonly intent: Id<"int">;
  readonly host: VenueHost;
  readonly simulator: Simulator;
  readonly prices: PriceSource;
  /** The native coin of the trade's chain, which pays its gas. */
  readonly nativeAsset: AssetRef;
  /** The most fee per gas a transaction pays now on the trade's chain, from the wallet's facts. */
  readonly feePerGasBase: bigint;
  /**
   * The venue whose quote the policy priced the trade from, and how to check the policy again on
   * another venue's quote. A re-quote at a tap checks no policy and leaves both out.
   */
  readonly policy?: {
    readonly pricedVenue: string;
    readonly recheck: (quoted: TradeQuote) => Promise<PolicyVerdict>;
  };
  readonly signal: AbortSignal;
}

/** The route the best quote chose: its built plan, its simulation, and the policy's new pass. */
export interface ChosenRoute {
  /** The chosen venue's plan, its quote carrying the simulation's network fee. */
  readonly planned: PlannedSwap;
  /** The simulation of the chosen plan, which the simulate step stores; a failure ends the intent. */
  readonly simulation: Result<SimulatedSteps, SimulationFailure>;
  /** The policy's pass on the chosen venue's quote, when it is not the quote the policy priced. */
  readonly pass?: PolicyPass;
}

/** One venue's quote, built and simulated. */
interface Candidate {
  readonly quoted: TradeQuote;
  readonly planned: Result<PlannedSwap, QuoteFailure>;
  readonly simulation?: Result<SimulatedSteps, SimulationFailure>;
}

async function candidateOf(quoted: TradeQuote, options: RouteChoiceOptions): Promise<Candidate> {
  const { host, nativeAsset, signal } = options;
  const planned = await buildSwap(options.swap, quoted, { host, nativeAsset, signal });
  if (!planned.ok) {
    return { quoted, planned };
  }
  const simulation = await options.simulator.simulate(options.intent, planned.value.built, {
    signal,
  });
  return { quoted, planned, simulation };
}

// The native coin's worth in the asset bought: one for one when the trade buys the coin, else
// through USD prices, a token the source cannot price taking its price from the first quote.
async function nativeToAssetOut(
  first: TradeQuote | undefined,
  options: RouteChoiceOptions,
): Promise<Ratio | undefined> {
  const { assetOut } = options.swap.trade;
  if (assetOut === options.nativeAsset) {
    return { numerator: 1n, denominator: 1n };
  }
  const trade =
    first === undefined
      ? undefined
      : { amountIn: first.trade.amountIn, expectedOut: first.quote.expectedOut };
  const prices = trade === undefined ? options.prices : withQuotePrice(options.prices, trade);
  const call = { signal: options.signal };
  const [native, out] = await Promise.all([
    prices.usdPrice(options.nativeAsset, call),
    prices.usdPrice(assetOut, call),
  ]);
  if (!native.ok || !out.ok || out.value.numerator <= 0n || native.value.denominator <= 0n) {
    return undefined;
  }
  return {
    numerator: native.value.numerator * out.value.denominator,
    denominator: native.value.denominator * out.value.numerator,
  };
}

// The chosen plan's quote carries the network fee its simulation measured.
function chosenOf(
  candidate: Candidate,
  options: RouteChoiceOptions,
  pass: PolicyPass | undefined,
): ChosenRoute | undefined {
  const { planned, simulation } = candidate;
  if (!planned.ok || simulation === undefined) {
    return undefined;
  }
  const gasUsed = simulation.ok ? simulation.value.gasUsed : 0n;
  const gas = { asset: options.nativeAsset, base: gasUsed * options.feePerGasBase };
  const { built } = planned.value;
  const chosenPlan = { ...planned.value, built: { ...built, quote: { ...built.quote, gas } } };
  return pass === undefined
    ? { planned: chosenPlan, simulation }
    : { planned: chosenPlan, simulation, pass };
}

/** A route whose simulation passed, with what it measured. */
interface Passed {
  readonly candidate: Candidate;
  readonly steps: SimulatedSteps;
}

// The policy's word on each route: none needed for the one it priced, or without a policy.
async function verdictsOf(
  ranked: readonly Passed[],
  options: RouteChoiceOptions,
): Promise<readonly (PolicyVerdict | undefined)[]> {
  const { policy } = options;
  return Promise.all(
    ranked.map(async ({ candidate }) =>
      policy === undefined || candidate.quoted.trade.venue === policy.pricedVenue
        ? undefined
        : policy.recheck(candidate.quoted),
    ),
  );
}

// The first route, best first, that the policy passes: the one it priced, or one it passes again.
async function firstPassing(
  ranked: readonly Passed[],
  options: RouteChoiceOptions,
): Promise<ChosenRoute | undefined> {
  const verdicts = await verdictsOf(ranked, options);
  const place = verdicts.findIndex((verdict) => verdict === undefined || verdict.ok);
  const winner = ranked[place];
  const verdict = verdicts[place];
  return winner === undefined
    ? undefined
    : chosenOf(winner.candidate, options, verdict?.ok === true ? verdict.value : undefined);
}

// With no route passing, the venue the policy priced, else the first in order, reports why.
function fallbackOf(
  candidates: readonly Candidate[],
  options: RouteChoiceOptions,
): Result<ChosenRoute, QuoteFailure> {
  const priced = options.policy?.pricedVenue;
  const lead =
    candidates.find((candidate) => candidate.quoted.trade.venue === priced) ?? candidates[0];
  const chosen = lead === undefined ? undefined : chosenOf(lead, options, undefined);
  if (chosen !== undefined) {
    return ok(chosen);
  }
  return lead !== undefined && !lead.planned.ok ? err(lead.planned.error) : err("venue_down");
}

/**
 * The best quote (decision 0107): builds every venue's quote through the venue host and simulates
 * each plan, then ranks the plans whose simulation passed by what the wallet receives, net of the
 * network fee valued in the asset bought, so a transfer tax counts as the simulation measured it.
 * The policy checks the chosen route again unless it is the one it priced; a route it refuses
 * gives way to the next. With no route passing, the venue the policy priced keeps its build
 * failure or its failed simulation, so the intent ends with that reason; with no quote at all, the
 * first venue's refusal stands.
 */
export async function chooseRoute(
  quotes: readonly QuoteOutcome[],
  options: RouteChoiceOptions,
): Promise<Result<ChosenRoute, QuoteFailure>> {
  const quoted = quotes.flatMap((quote) => (quote.ok ? [quote.value] : []));
  if (quoted.length === 0) {
    const [first] = quotes;
    return err(first !== undefined && !first.ok ? first.error : "venue_down");
  }
  const candidates = await Promise.all(quoted.map(async (item) => candidateOf(item, options)));
  const passed = candidates.flatMap((candidate): Passed[] =>
    candidate.simulation?.ok === true ? [{ candidate, steps: candidate.simulation.value }] : [],
  );
  const rate = await nativeToAssetOut(quoted[0], options);
  const values = passed.map(({ steps }) => ({
    receivedBase: steps.received[0]?.base ?? 0n,
    gasBase: gasInAssetOut(steps.gasUsed, options.feePerGasBase, rate),
  }));
  const ranked = rankRoutes(values).flatMap((index) => passed.slice(index, index + 1));
  const chosen = await firstPassing(ranked, options);
  return chosen === undefined ? fallbackOf(candidates, options) : ok(chosen);
}
