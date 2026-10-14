import type { PriceSource } from "@binference/chain";
import { type Clock, err, type IdSource, ok, type Result } from "@binference/core";
import type { AssetInfos, IntentRequest, ProtocolErrorCode } from "@binference/protocol";
import type { CapGate } from "../confirmations/cap-gate.js";
import { gasReadingOf, type LowGasAlerts } from "../gas/low-gas-alerts.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { planDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import type { PolicyRejection } from "../intents/intent-reason.js";
import type { IntentProposerRef } from "../intents/intent-record.js";
import type { IntentProposer } from "../intents/intent-status.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import { createIntentStateMachine, type IntentStateMachine } from "../intents/state-machine.js";
import type { PolicyCheck, PolicyPass, PolicyVerdict } from "../policy/check-policy.js";
import type { PolicySubject } from "../policy/policy-rules.js";
import type { AgentStore, RiskCheck, Simulator } from "../ports.js";
import type { QuoteOutcome, TradePlan, TradeQuote, VenueHost } from "../venues/venue-host.js";
import { advanceIntent } from "./advance-intent.js";
import { authorizeSimulated, type FillProposal } from "./authorize-simulated.js";
import { type ChosenRoute, chooseRoute, type RouteChoiceOptions } from "./choose-route.js";
import type { ExecuteConfirmed } from "./execute-confirmed.js";
import { type PlacedTrade, placeTrade } from "./place-trade.js";
import { policyFactsOf } from "./policy-facts-of.js";
import { proposalProblemCode } from "./proposal-problem-code.js";
import { firstQuoteOf, quotedTradeOf, quoteVenues } from "./quote-venues.js";
import { type ResolvedProposal, type ResolveOptions, resolveProposal } from "./resolve-proposal.js";
import { assessRisk, storeSimulation } from "./risk-and-simulation.js";
import { proposalOf, storeProposed } from "./store-proposed.js";
import { type SwapTrade, swapSubjectOf } from "./swap-trade.js";
import { type ReadTokenFacts, unlistedAssetInfos } from "./token-facts.js";
import type { Holdings } from "./wallet-facts.js";

/** Who proposes: their role for the state machine, and their id for the intents table. */
export interface Proposer {
  readonly role: IntentProposer;
  readonly ref: IntentProposerRef;
  /** The proposal comes from a turn with the outside-content mark, which the intent keeps. */
  readonly hasOutsideContent: boolean;
}

/**
 * Steps 1 to 6 of the money path (ARCHITECTURE.md section 7): resolve, policy, quote and build,
 * risk, simulation, and the card or the auto mode's authorization. Every allowed venue quotes
 * before the policy decides, so the caps judge the trade at the first venue's quote; nothing is
 * built before the policy passes. The best quote then picks the route by simulation (decision
 * 0107), and risk and the stored simulation follow that route. An intent the auto mode confirms
 * goes on to the execute step at once: it fills on paper, or the executor takes it.
 */
export interface MoneyPath {
  /**
   * Stores a proposal and runs it until it waits for the owner or ends. A refusal by policy,
   * venue, risk or simulation is the intent's state, not an error. A request that cannot become
   * an intent, such as one for an unknown agent or another agent's wallet, is a protocol error
   * code and stores nothing.
   */
  propose(
    request: IntentRequest,
    proposer: Proposer,
    options: { readonly signal: AbortSignal; readonly fill?: FillProposal },
  ): Promise<Result<IntentSnapshot, ProtocolErrorCode>>;
}

/** The ports and steps the money path runs on. */
export interface MoneyPathOptions extends ResolveOptions {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** What a wallet holds of the asset a sale by share sells, in the intent's mode. */
  readonly holdings: Holdings;
  readonly policy: PolicyCheck;
  /** The USD prices that value each route's network fee in the asset bought. */
  readonly prices: PriceSource;
  readonly host: VenueHost;
  /** Weighs the token a quoted trade buys, before the simulation. */
  readonly risk: RiskCheck;
  readonly simulator: Simulator;
  /** Reads what a token the registry does not list answers on chain, for its card. */
  readonly readTokenFacts: ReadTokenFacts;
  readonly execute: ExecuteConfirmed;
  /** Whether the engine is locked: no live intent is authorized by auto mode while it is. */
  readonly isLocked: () => boolean;
  /** Told each live wallet's native balance as a proposal reads it. */
  readonly lowGas: LowGasAlerts;
  /** The rolling cap each confirmation is checked against, one agent's at a time. */
  readonly gate: CapGate;
  readonly clock: Clock;
  readonly ids: IdSource;
}

interface Run {
  readonly options: MoneyPathOptions;
  readonly machine: IntentStateMachine;
  readonly resolved: ResolvedProposal;
  readonly signal: AbortSignal;
  readonly fill?: FillProposal;
}

/** A run whose trade has its place and its amount settled. */
interface PlacedRun extends Run {
  readonly swap: SwapTrade;
}

/** A step's result: the intent after it, and what later steps read when the step passed. */
interface Stepped<T> {
  readonly snapshot: IntentSnapshot;
  readonly passed?: T;
}

async function advance(
  run: Run,
  snapshot: IntentSnapshot,
  move: { readonly trigger: IntentTrigger } & Pick<IntentMove, "fields">,
): Promise<IntentSnapshot> {
  const parts = { stored: run.options.stored, machine: run.machine, signal: run.signal };
  return advanceIntent(parts, snapshot, move);
}

// What the policy judges: the intent's subject on a venue, and the facts of its wallet.
async function policyVerdict(
  run: PlacedRun,
  status: Pick<PolicySubject, "kind" | "isPaper" | "hasOutsideContent">,
  priced: { readonly quote?: TradeQuote; readonly venue?: string },
): Promise<PolicyVerdict> {
  const { resolved, options, signal } = run;
  const subject = swapSubjectOf(run.swap, status);
  const facts = policyFactsOf({
    settings: resolved.settings,
    wallet: resolved.facts,
    chain: resolved.chain.ref,
    chains: options.chains,
    nativeAsset: resolved.nativeAsset,
    nowMs: options.clock.now(),
  });
  const call =
    priced.quote === undefined ? { signal } : { signal, quote: quotedTradeOf(priced.quote) };
  const judged = priced.venue === undefined ? subject : { ...subject, venue: priced.venue };
  return options.policy.check(judged, facts, call);
}

// A sale of a token on the deny list always asks the owner, and a fill has no card to ask with
// (decision 0195).
function fillVerdict(run: Run, verdict: PolicyVerdict): Result<PolicyPass, PolicyRejection> {
  return verdict.ok && run.fill !== undefined && verdict.value.sellsDeniedToken
    ? err("token_denied")
    : verdict;
}

// The first venue's quote prices the trade's other token; a trade no venue could quote is judged
// without one, so its policy refusal still comes first.
async function checkPolicy(
  run: PlacedRun,
  snapshot: IntentSnapshot,
  quote: QuoteOutcome,
): Promise<Stepped<PolicyPass>> {
  const priced = quote.ok ? { quote: quote.value } : {};
  const verdict = fillVerdict(run, await policyVerdict(run, snapshot.stored.status, priced));
  if (!verdict.ok) {
    const refused = { type: "policy_refused", reason: verdict.error } as const;
    return { snapshot: await advance(run, snapshot, { trigger: refused }) };
  }
  const checked = await advance(run, snapshot, { trigger: { type: "policy_passed" } });
  return checked.record.state === "checked"
    ? { snapshot: checked, passed: verdict.value }
    : { snapshot: checked };
}

// The best quote weighs every venue's quote; the policy judges again a route it did not price.
function routeChoiceOf(
  run: PlacedRun,
  snapshot: IntentSnapshot,
  quotes: readonly QuoteOutcome[],
): RouteChoiceOptions {
  const { resolved, options, signal } = run;
  const first = firstQuoteOf(quotes);
  const recheck = async (quoted: TradeQuote): Promise<PolicyVerdict> =>
    policyVerdict(run, snapshot.stored.status, { quote: quoted, venue: quoted.trade.venue });
  return {
    swap: run.swap,
    intent: snapshot.record.id,
    host: options.host,
    simulator: options.simulator,
    prices: options.prices,
    nativeAsset: resolved.nativeAsset,
    feePerGasBase: resolved.facts.feePerGasNativeBase,
    maxPriceImpactBps: resolved.settings.limits.priceImpactBps,
    ...(first.ok ? { policy: { pricedVenue: first.value.trade.venue, recheck } } : {}),
    signal,
  };
}

// The intent stores its quote, its plan and the value the policy judged the chosen route at, which
// the rolling cap counts once it is confirmed (decision 0136).
async function build(
  run: PlacedRun,
  snapshot: IntentSnapshot,
  priced: { readonly quotes: readonly QuoteOutcome[]; readonly pass: PolicyPass },
): Promise<Stepped<ChosenRoute>> {
  const { quotes } = priced;
  const chosen = await chooseRoute(quotes, routeChoiceOf(run, snapshot, quotes));
  if (!chosen.ok) {
    const failed = { type: "quote_failed", reason: chosen.error } as const;
    return { snapshot: await advance(run, snapshot, { trigger: failed }) };
  }
  const { plan, built } = chosen.value.planned;
  const { figures } = chosen.value.pass ?? priced.pass;
  const fields = {
    quote: quoteDocument.encode(built.quote),
    plan: planDocument.encode(built.steps),
    ...(figures === undefined ? {} : { valueUsdMicros: figures.valueUsdMicros }),
  };
  const trigger = { type: "quote_built", quote: plan.terms } as const;
  const quoted = await advance(run, snapshot, { trigger, fields });
  return quoted.record.state === "quoted"
    ? { snapshot: quoted, passed: chosen.value }
    : { snapshot: quoted };
}

// The trade's place and amount, settled as its quote is built (spec 6, section 5): a sale by
// share reads what the wallet holds now, in the intent's mode. A curve read that failed as it
// picked the wallet ends the trade first (decision 0218).
async function placedTradeOf(run: Run, snapshot: IntentSnapshot): Promise<PlacedTrade> {
  const { resolved, options, signal } = run;
  const { wallet, account, nativeAsset, settings, launchWallet } = resolved;
  const { chains, host, holdings } = options;
  const { isPaper } = snapshot.record;
  const { limits } = settings;
  const context = { limits, account, chains, host, nativeAsset, holdings, wallet, isPaper, signal };
  const placed = await placeTrade(
    resolved.ask,
    launchWallet === undefined ? context : { ...context, launchWallet },
  );
  return resolved.launchUnread === true ? { ...placed, refusal: "launch_unread" } : placed;
}

// A trade that cannot be placed is judged by the policy first, and asks no venue: a policy
// refusal comes first, as for a trade no venue could quote, and else its check reason ends it.
async function runSteps(run: Run, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  const { host, clock } = run.options;
  const placed = await placedTradeOf(run, proposed);
  const priced: PlacedRun = { ...run, swap: placed.swap };
  const quotes =
    placed.refusal === undefined
      ? await quoteVenues(placed.swap, { host, clock, signal: run.signal })
      : [];
  const policy = await checkPolicy(priced, proposed, firstQuoteOf(quotes));
  if (policy.passed === undefined) {
    return policy.snapshot;
  }
  if (placed.refusal !== undefined) {
    const failed = { type: "quote_failed", reason: placed.refusal } as const;
    return advance(run, policy.snapshot, { trigger: failed });
  }
  const quoted = await build(priced, policy.snapshot, { quotes, pass: policy.passed });
  if (quoted.passed === undefined) {
    return quoted.snapshot;
  }
  // A chosen route whose simulation failed ends with that reason; no risk check weighs it.
  const { simulation, planned } = quoted.passed;
  const parts = { stored: run.options.stored, machine: run.machine, signal: run.signal };
  const { risk } = run.options;
  const riskParts = {
    ...parts,
    risk,
    trade: placed.swap.trade,
    limits: run.resolved.settings.limits,
  };
  const assessed = simulation.ok
    ? await assessRisk(riskParts, quoted.snapshot, planned)
    : quoted.snapshot;
  if (simulation.ok && assessed.record.state !== "assessed") {
    return assessed;
  }
  const simulated = await storeSimulation(parts, assessed, simulation);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  const pass = quoted.passed.pass ?? policy.passed;
  return authorizeAndExecute(run, simulated, { pass, plan: planned.plan });
}

// Step 6, then the execute step for an intent it confirmed.
async function authorizeAndExecute(
  run: Run,
  simulated: IntentSnapshot,
  chosen: { readonly pass: PolicyPass; readonly plan: TradePlan },
): Promise<IntentSnapshot> {
  const { stored, gate, isLocked, execute } = run.options;
  const { machine, signal, fill } = run;
  const { facts: wallet, chain } = run.resolved;
  const parts = { stored, machine, signal, gate, isLocked, wallet, family: chain.family };
  const authorized = await authorizeSimulated(
    fill === undefined ? parts : { ...parts, fill },
    simulated,
    chosen,
  );
  return execute(authorized, fill === undefined ? { signal } : { signal, fill });
}

// What the trade's tokens the registry does not list answer on chain, for its card. A fill opens
// no card, so it reads none.
async function assetsOf(
  options: MoneyPathOptions,
  proposal: { readonly resolved: ResolvedProposal; readonly fill: FillProposal | undefined },
  signal: AbortSignal,
): Promise<Result<AssetInfos, "asset.unreadable">> {
  const { assetIn, assetOut } = proposal.resolved.ask;
  if (proposal.fill !== undefined) {
    return ok({});
  }
  const assets = assetOut === undefined ? [assetIn] : [assetIn, assetOut];
  return unlistedAssetInfos(options, assets, signal);
}

async function propose(
  options: MoneyPathOptions,
  call: {
    readonly request: IntentRequest;
    readonly proposer: Proposer;
    readonly fill?: FillProposal;
  },
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const { request, proposer, fill } = call;
  const machine = createIntentStateMachine({ clock: options.clock });
  const settings = await options.agents.get(request.agent, { signal });
  const proposal = proposalOf(call, settings);
  const step = machine.propose(proposal);
  if (!step.ok || settings === undefined) {
    return err(step.ok ? "agent.not_found" : proposalProblemCode(step.error));
  }
  const { isPaper } = proposal;
  const resolved = await resolveProposal(options, { request, settings, signal, isPaper });
  if (!resolved.ok) {
    return resolved;
  }
  if (!isPaper) {
    options.lowGas.check(gasReadingOf(resolved.value));
  }
  const assets = await assetsOf(options, { resolved: resolved.value, fill }, signal);
  if (!assets.ok) {
    return assets;
  }
  const intent = { request, proposer, step: step.value, wallet: resolved.value.wallet };
  const created = await storeProposed(options, { ...intent, assets: assets.value }, signal);
  const run = { options, machine, resolved: resolved.value, signal };
  return ok(await runSteps(fill === undefined ? run : { ...run, fill }, created));
}

/** Creates the {@link MoneyPath} over its ports. */
export function createMoneyPath(options: MoneyPathOptions): MoneyPath {
  return {
    propose: async (request, proposer, { signal, fill }) =>
      propose(options, { request, proposer, ...(fill === undefined ? {} : { fill }) }, signal),
  };
}
