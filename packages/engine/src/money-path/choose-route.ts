import { type AssetRef, type PriceSource, withQuotePrice } from "@binference/chain";
import { type Bps, err, type Id, ok, type Ratio, type Result } from "@binference/core";
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
  /** The agent's maximum price impact: a quote above it is never built. */
  readonly maxPriceImpactBps: Bps;
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

// A port that throws fails only the route it was asked about; an abort still ends the choice.
async function unlessThrown<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  try {
    return await work;
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}

// A simulator that throws leaves the plan without a simulation, so it never passes.
async function candidateOf(quoted: TradeQuote, options: RouteChoiceOptions): Promise<Candidate> {
  const { host, nativeAsset, signal } = options;
  const planned = await buildSwap(options.swap, quoted, { host, nativeAsset, signal });
  if (!planned.ok) {
    return { quoted, planned };
  }
  const built = planned.value.built;
  const simulation = await unlessThrown(
    options.simulator.simulate(options.intent, built, { signal }),
    signal,
  );
  return simulation === undefined ? { quoted, planned } : { quoted, planned, simulation };
}

type PriceAnswer = Awaited<ReturnType<PriceSource["usdPrice"]>>;

// The USD prices of the native coin and of the asset bought, a token the source cannot price
// taking its price from the first quote. A price source that throws gives no prices.
async function usdPricesOf(
  first: TradeQuote | undefined,
  options: RouteChoiceOptions,
): Promise<readonly PriceAnswer[]> {
  const trade =
    first === undefined
      ? undefined
      : { amountIn: first.trade.amountIn, expectedOut: first.quote.expectedOut };
  const prices = trade === undefined ? options.prices : withQuotePrice(options.prices, trade);
  const { signal } = options;
  const answers = Promise.all([
    prices.usdPrice(options.nativeAsset, { signal }),
    prices.usdPrice(options.swap.trade.assetOut, { signal }),
  ]);
  return (await unlessThrown(answers, signal)) ?? [];
}

// The native coin's worth in the asset bought: one for one when the trade buys the coin, else
// through their USD prices.
async function nativeToAssetOut(
  first: TradeQuote | undefined,
  options: RouteChoiceOptions,
): Promise<Ratio | undefined> {
  if (options.swap.trade.assetOut === options.nativeAsset) {
    return { numerator: 1n, denominator: 1n };
  }
  const [native, out] = await usdPricesOf(first, options);
  if (native?.ok !== true || out?.ok !== true) {
    return undefined;
  }
  return out.value.numerator <= 0n || native.value.denominator <= 0n
    ? undefined
    : {
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

/** The policy's word on one route, and its new pass when it judged the route again. */
interface RouteVerdict {
  readonly passes: boolean;
  readonly pass?: PolicyPass;
}

// None is needed for the route the policy priced, or without a policy. A check that throws
// refuses the route.
async function verdictOf(candidate: Candidate, options: RouteChoiceOptions): Promise<RouteVerdict> {
  const { policy, signal } = options;
  if (policy === undefined || candidate.quoted.trade.venue === policy.pricedVenue) {
    return { passes: true };
  }
  const verdict = await unlessThrown(policy.recheck(candidate.quoted), signal);
  return verdict?.ok === true ? { passes: true, pass: verdict.value } : { passes: false };
}

// The first route, best first, that the policy passes: the one it priced, or one it passes again.
async function firstPassing(
  ranked: readonly Passed[],
  options: RouteChoiceOptions,
): Promise<ChosenRoute | undefined> {
  const verdicts = await Promise.all(
    ranked.map(async ({ candidate }) => verdictOf(candidate, options)),
  );
  const place = verdicts.findIndex((verdict) => verdict.passes);
  const winner = ranked[place];
  return winner === undefined
    ? undefined
    : chosenOf(winner.candidate, options, verdicts[place]?.pass);
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
 * The best quote (decision 0107): drops every quote whose price impact is above the agent's
 * maximum, builds the others through the venue host and simulates each plan, then ranks the plans
 * whose simulation passed by what the wallet receives, net of the network fee valued in the asset
 * bought, so a transfer tax counts as the simulation measured it. The policy checks the chosen
 * route again unless it is the one it priced; a route it refuses gives way to the next. With no
 * route passing, the venue the policy priced keeps its build failure or its failed simulation, so
 * the intent ends with that reason. With no quote at all, the first venue's refusal stands; with
 * every quote above the maximum, `price_impact` (spec 6, section 4). An impact a venue cannot
 * tell is the whole input, so it is dropped like any other above the maximum. A simulator or a
 * policy check that throws fails only the route it was asked about, and a plan left without a
 * simulation ends as `venue_down`; a price source that throws ranks the plans as one without a
 * price does. Only an aborted signal rejects.
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
  const bounded = quoted.filter(({ quote }) => quote.priceImpactBps <= options.maxPriceImpactBps);
  if (bounded.length === 0) {
    return err("price_impact");
  }
  const candidates = await Promise.all(bounded.map(async (item) => candidateOf(item, options)));
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
