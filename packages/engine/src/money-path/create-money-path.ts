import type { ChainRegistry, PriceSource, QuotedTrade, Signer } from "@binference/chain";
import { BinferenceError, type Clock, err, type IdSource, ok, type Result } from "@binference/core";
import type { IntentRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { gasReadingOf, type LowGasAlerts } from "../gas/low-gas-alerts.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import {
  planDocument,
  quoteDocument,
  riskDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { IntentProposerRef } from "../intents/intent-record.js";
import type { IntentProposer } from "../intents/intent-status.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import {
  type AgentStatus,
  createIntentStateMachine,
  type IntentStateMachine,
  type ProposalProblem,
} from "../intents/state-machine.js";
import type { PolicyCheck, PolicyPass, PolicyVerdict } from "../policy/check-policy.js";
import type { PolicySubject } from "../policy/policy-rules.js";
import type { AgentStore, RiskCheck, Simulator, WalletFactsSource } from "../ports.js";
import { type SimulatedSteps, simulationViewOf } from "../simulation/simulated-steps.js";
import type { QuoteOutcome, TradeQuote, VenueHost } from "../venues/venue-host.js";
import { advanceIntent } from "./advance-intent.js";
import { authorizationCheckOf } from "./authorization-check-of.js";
import { type ChosenRoute, chooseRoute, type RouteChoiceOptions } from "./choose-route.js";
import type { ExecuteConfirmed } from "./execute-confirmed.js";
import type { PlannedSwap } from "./plan-swap.js";
import { policyFactsOf } from "./policy-facts-of.js";
import { firstQuoteOf, quoteVenues } from "./quote-venues.js";
import { type ResolvedProposal, resolveProposal } from "./resolve-proposal.js";
import { swapSubjectOf } from "./swap-trade.js";

/** Who proposes: their role for the state machine, and their id for the intents table. */
export interface Proposer {
  readonly role: IntentProposer;
  readonly ref: IntentProposerRef;
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
    options: { readonly signal: AbortSignal },
  ): Promise<Result<IntentSnapshot, ProtocolErrorCode>>;
}

/** The ports and steps the money path runs on. */
export interface MoneyPathOptions {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly policy: PolicyCheck;
  /** The USD prices that value each route's network fee in the asset bought. */
  readonly prices: PriceSource;
  readonly host: VenueHost;
  /** Weighs the token a quoted trade buys, before the simulation. */
  readonly risk: RiskCheck;
  readonly simulator: Simulator;
  readonly chains: ChainRegistry;
  readonly execute: ExecuteConfirmed;
  /** Whether the engine is locked: no live intent is authorized by auto mode while it is. */
  readonly isLocked: () => boolean;
  /** Told each live wallet's native balance as a proposal reads it. */
  readonly lowGas: LowGasAlerts;
  readonly clock: Clock;
  readonly ids: IdSource;
}

interface Run {
  readonly options: MoneyPathOptions;
  readonly machine: IntentStateMachine;
  readonly resolved: ResolvedProposal;
  readonly signal: AbortSignal;
}

/** A step's result: the intent after it, and what later steps read when the step passed. */
interface Stepped<T> {
  readonly snapshot: IntentSnapshot;
  readonly passed?: T;
}

const problemCodes: Readonly<Record<ProposalProblem, ProtocolErrorCode>> = {
  agent_missing: "agent.not_found",
  agent_archived: "agent.archived",
  wrong_proposer: "auth.scope",
};

function agentStatusOf(settings: AgentSettings | undefined): AgentStatus {
  if (settings === undefined) {
    return "missing";
  }
  return settings.agent.archivedAtMs === undefined ? "active" : "archived";
}

async function advance(
  run: Run,
  snapshot: IntentSnapshot,
  move: { readonly trigger: IntentTrigger } & Pick<IntentMove, "fields">,
): Promise<IntentSnapshot> {
  const parts = { stored: run.options.stored, machine: run.machine, signal: run.signal };
  return advanceIntent(parts, snapshot, move);
}

function quotedTradeOf({ trade, quote }: TradeQuote): QuotedTrade {
  return { amountIn: trade.amountIn, expectedOut: quote.expectedOut };
}

// What the policy judges: the intent's subject on a venue, and the facts of its wallet.
async function policyVerdict(
  run: Run,
  status: Pick<PolicySubject, "kind" | "isPaper" | "hasOutsideContent">,
  priced: { readonly quote?: TradeQuote; readonly venue?: string },
): Promise<PolicyVerdict> {
  const { resolved, options, signal } = run;
  const subject = swapSubjectOf(resolved.swap, status);
  const facts = policyFactsOf({
    settings: resolved.settings,
    wallet: resolved.facts,
    chain: resolved.chain.ref,
    nativeAsset: resolved.nativeAsset,
    nowMs: options.clock.now(),
  });
  const call =
    priced.quote === undefined ? { signal } : { signal, quote: quotedTradeOf(priced.quote) };
  const judged = priced.venue === undefined ? subject : { ...subject, venue: priced.venue };
  return options.policy.check(judged, facts, call);
}

// The first venue's quote prices the trade's other token; a trade no venue could quote is judged
// without one, so its policy refusal still comes first.
async function checkPolicy(
  run: Run,
  snapshot: IntentSnapshot,
  quote: QuoteOutcome,
): Promise<Stepped<PolicyPass>> {
  const priced = quote.ok ? { quote: quote.value } : {};
  const verdict = await policyVerdict(run, snapshot.stored.status, priced);
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
  run: Run,
  snapshot: IntentSnapshot,
  quotes: readonly QuoteOutcome[],
): RouteChoiceOptions {
  const { resolved, options, signal } = run;
  const first = firstQuoteOf(quotes);
  const recheck = async (quoted: TradeQuote): Promise<PolicyVerdict> =>
    policyVerdict(run, snapshot.stored.status, { quote: quoted, venue: quoted.trade.venue });
  return {
    swap: resolved.swap,
    intent: snapshot.record.id,
    host: options.host,
    simulator: options.simulator,
    prices: options.prices,
    nativeAsset: resolved.nativeAsset,
    feePerGasBase: resolved.facts.feePerGasNativeBase,
    ...(first.ok ? { policy: { pricedVenue: first.value.trade.venue, recheck } } : {}),
    signal,
  };
}

// The intent stores its quote, its plan and the value the policy judged the chosen route at, which
// the rolling cap counts once it is confirmed (decision 0136).
async function build(
  run: Run,
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

// The risk step weighs the token the chosen route buys at the quote it was built from, against the
// agent's tax and liquidity limits, and stores its view whether it passes or refuses.
async function assessRisk(
  run: Run,
  snapshot: IntentSnapshot,
  planned: PlannedSwap,
): Promise<IntentSnapshot> {
  const { plan } = planned;
  const quoted = {
    trade: { ...run.resolved.swap.trade, venue: plan.venue },
    quote: plan.quote,
    quotedAtMs: plan.terms.quotedAtMs,
  };
  const { taxBps, liquidityFloorUsdMicros } = run.resolved.settings.limits;
  const limits = { maxTaxBps: taxBps, liquidityFloorUsdMicros };
  const assessment = await run.options.risk.assess({ quoted, limits }, { signal: run.signal });
  const fields = { risk: riskDocument.encode(assessment.view) };
  const trigger =
    assessment.refusal === undefined
      ? ({ type: "risk_passed" } as const)
      : ({ type: "risk_refused", reason: assessment.refusal } as const);
  return advance(run, snapshot, { trigger, fields });
}

// The chosen route was simulated when the best quote weighed it; this step stores that run.
async function simulate(
  run: Run,
  snapshot: IntentSnapshot,
  simulation: Result<SimulatedSteps, SimulationFailure>,
): Promise<IntentSnapshot> {
  if (!simulation.ok) {
    return advance(run, snapshot, {
      trigger: { type: "simulation_failed", reason: simulation.error },
    });
  }
  const fields = { simulation: simulationDocument.encode(simulationViewOf(simulation.value)) };
  return advance(run, snapshot, { trigger: { type: "simulation_matched" }, fields });
}

async function runSteps(run: Run, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  const { host, clock } = run.options;
  const quotes = await quoteVenues(run.resolved.swap, { host, clock, signal: run.signal });
  const policy = await checkPolicy(run, proposed, firstQuoteOf(quotes));
  if (policy.passed === undefined) {
    return policy.snapshot;
  }
  const quoted = await build(run, policy.snapshot, { quotes, pass: policy.passed });
  if (quoted.passed === undefined) {
    return quoted.snapshot;
  }
  const assessed = await assessRisk(run, quoted.snapshot, quoted.passed.planned);
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  const simulated = await simulate(run, assessed, quoted.passed.simulation);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  // The auto test reads the agent as the move to `simulated` read it back, so a switch to manual
  // during the run asks at once.
  const trigger = authorizationCheckOf({
    settings: simulated.settings,
    pass: quoted.passed.pass ?? policy.passed,
    wallet: run.resolved.facts,
    isLocked: run.options.isLocked() && !simulated.record.isPaper,
  });
  const authorized = await advance(run, simulated, { trigger });
  return run.options.execute(authorized, { signal: run.signal });
}

async function propose(
  options: MoneyPathOptions,
  call: { readonly request: IntentRequest; readonly proposer: Proposer },
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const { request, proposer } = call;
  const machine = createIntentStateMachine({ clock: options.clock });
  const settings = await options.agents.get(request.agent, { signal });
  const step = machine.propose({
    kind: request.kind,
    proposer: proposer.role,
    isPaper: settings?.agent.mode === "paper",
    hasOutsideContent: false,
    agentStatus: agentStatusOf(settings),
  });
  if (!step.ok || settings === undefined) {
    return err(step.ok ? "agent.not_found" : problemCodes[step.error]);
  }
  const resolved = await resolveProposal(options, { request, settings, signal });
  if (!resolved.ok) {
    return resolved;
  }
  if (settings.agent.mode === "live") {
    options.lowGas.check(gasReadingOf(resolved.value));
  }
  const { wallet } = resolved.value;
  const intent = { id: options.ids.next("int"), agentId: request.agent, walletId: wallet };
  const created = await options.stored.create(
    { ...intent, request, proposerRef: proposer.ref, step: step.value },
    { signal },
  );
  if (!created.ok) {
    throw new BinferenceError({ code: "engine.id_taken", message: "A new intent id was taken." });
  }
  return ok(await runSteps({ options, machine, resolved: resolved.value, signal }, created.value));
}

/** Creates the {@link MoneyPath} over its ports. */
export function createMoneyPath(options: MoneyPathOptions): MoneyPath {
  return {
    propose: async (request, proposer, { signal }) =>
      propose(options, { request, proposer }, signal),
  };
}
