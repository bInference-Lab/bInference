import type { ChainRegistry, Signer } from "@binference/chain";
import { BinferenceError, type Clock, err, type IdSource, ok, type Result } from "@binference/core";
import type { IntentRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { cardRulesOf } from "../agents/card-rules-of.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import {
  planDocument,
  quoteDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import type { IntentProposerRef } from "../intents/intent-record.js";
import type { IntentProposer } from "../intents/intent-status.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import {
  type AgentStatus,
  createIntentStateMachine,
  type IntentStateMachine,
  type ProposalProblem,
} from "../intents/state-machine.js";
import type { PaperFills } from "../paper/paper-fills.js";
import type { PolicyCheck, PolicyPass } from "../policy/check-policy.js";
import type { AgentStore, Simulator, WalletFactsSource } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
import { type PlannedSwap, planSwap } from "./plan-swap.js";
import { policyFactsOf } from "./policy-facts-of.js";
import { registryRisk } from "./registry-risk.js";
import { type ResolvedProposal, resolveProposal } from "./resolve-proposal.js";
import { swapSubjectOf } from "./swap-trade.js";

/** Who proposes: their role for the state machine, and their id for the intents table. */
export interface Proposer {
  readonly role: IntentProposer;
  readonly ref: IntentProposerRef;
}

/**
 * Steps 1 to 6 of the money path (ARCHITECTURE.md section 7): resolve, policy, quote and build,
 * risk, simulation, and the card or the auto mode's authorization. A confirmed paper intent fills
 * on paper at once.
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
  readonly host: VenueHost;
  readonly simulator: Simulator;
  readonly chains: ChainRegistry;
  readonly paper: PaperFills;
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

// A move that lost its version to another write, such as a cancel, ends the run where that write
// left the intent.
async function advance(
  run: Run,
  snapshot: IntentSnapshot,
  move: { readonly trigger: IntentTrigger } & Pick<IntentMove, "fields">,
): Promise<IntentSnapshot> {
  const { stored } = run.options;
  const step = run.machine.apply(snapshot.stored.status, move.trigger);
  if (!step.ok) {
    throw new BinferenceError({
      code: "engine.step_refused",
      message: `The state machine refused ${move.trigger.type} on intent ${snapshot.record.id}.`,
      details: { intent: snapshot.record.id, problem: step.error },
    });
  }
  const intent = snapshot.record.id;
  const write = { intent, version: snapshot.stored.version, step: step.value, by: "engine" };
  const moved = await stored.move({ ...write, ...move }, { signal: run.signal });
  return moved.ok
    ? moved.value
    : ((await stored.snapshot(intent, { signal: run.signal })) ?? snapshot);
}

async function checkPolicy(run: Run, snapshot: IntentSnapshot): Promise<Stepped<PolicyPass>> {
  const { resolved, options } = run;
  const { status } = snapshot.stored;
  const subject = swapSubjectOf(resolved.swap, status);
  const facts = policyFactsOf({
    settings: resolved.settings,
    wallet: resolved.facts,
    chain: resolved.chain.ref,
    nativeAsset: resolved.nativeAsset,
  });
  const verdict = await options.policy.check(subject, facts, { signal: run.signal });
  if (!verdict.ok) {
    const refused = { type: "policy_refused", reason: verdict.error } as const;
    return { snapshot: await advance(run, snapshot, { trigger: refused }) };
  }
  const checked = await advance(run, snapshot, { trigger: { type: "policy_passed" } });
  return checked.record.state === "checked"
    ? { snapshot: checked, passed: verdict.value }
    : { snapshot: checked };
}

async function quote(run: Run, snapshot: IntentSnapshot): Promise<Stepped<PlannedSwap>> {
  const { resolved, options } = run;
  const planned = await planSwap(resolved.swap, {
    host: options.host,
    nativeAsset: resolved.nativeAsset,
    signal: run.signal,
  });
  if (!planned.ok) {
    const failed = { type: "quote_failed", reason: planned.error } as const;
    return { snapshot: await advance(run, snapshot, { trigger: failed }) };
  }
  const { plan, built } = planned.value;
  const fields = {
    quote: quoteDocument.encode(built.quote),
    plan: planDocument.encode(built.steps),
  };
  const trigger = { type: "quote_built", quote: plan.terms } as const;
  const quoted = await advance(run, snapshot, { trigger, fields });
  return quoted.record.state === "quoted"
    ? { snapshot: quoted, passed: planned.value }
    : { snapshot: quoted };
}

async function simulate(
  run: Run,
  snapshot: IntentSnapshot,
  planned: PlannedSwap,
): Promise<IntentSnapshot> {
  const intent = snapshot.record.id;
  const simulation = await run.options.simulator.simulate(intent, planned.built, {
    signal: run.signal,
  });
  if (!simulation.ok) {
    return advance(run, snapshot, {
      trigger: { type: "simulation_failed", reason: simulation.error },
    });
  }
  const fields = { simulation: simulationDocument.encode(simulation.value) };
  return advance(run, snapshot, { trigger: { type: "simulation_matched" }, fields });
}

// The auto test reads the policy's figures; a passed swap always has them, as a missing price is
// a refusal. The fee per gas and the cap come with the wallet's facts.
function authorization(run: Run, pass: PolicyPass): IntentTrigger<"authorization_checked"> {
  const { settings, facts } = run.resolved;
  const { limits, approvalMode } = settings;
  const overCap = limits.perTradeUsdMicros + 1n;
  const autoFacts = {
    approvalMode: approvalMode.mode,
    modeVersion: approvalMode.version,
    isInsideOwnPositions: false,
    sellsDeniedToken: pass.sellsDeniedToken,
    valueUsdMicros: pass.figures?.valueUsdMicros ?? overCap,
    perTradeCapUsdMicros: limits.perTradeUsdMicros,
    rollingDayCapUsdMicros: limits.rollingDayUsdMicros,
    rollingDaySpentUsdMicros: pass.figures?.rollingDaySpentUsdMicros ?? 0n,
    feePerGasNativeBase: facts.feePerGasNativeBase,
    networkFeeCapNativeBase: facts.networkFeeCapNativeBase,
    hasUnlistedSpender: false,
  };
  const check = { by: "auto_mode", facts: autoFacts } as const;
  return { type: "authorization_checked", check, cards: cardRulesOf(limits) };
}

async function runSteps(run: Run, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  const policy = await checkPolicy(run, proposed);
  if (policy.passed === undefined) {
    return policy.snapshot;
  }
  const quoted = await quote(run, policy.snapshot);
  if (quoted.passed === undefined) {
    return quoted.snapshot;
  }
  const { assetOut, amountIn } = run.resolved.swap.trade;
  const risk = registryRisk(run.options.chains, [amountIn.asset, assetOut]);
  const assessed = await advance(run, quoted.snapshot, { trigger: risk });
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  const simulated = await simulate(run, assessed, quoted.passed);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  const authorized = await advance(run, simulated, { trigger: authorization(run, policy.passed) });
  return run.options.paper.fillAtQuote(authorized, { signal: run.signal });
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
