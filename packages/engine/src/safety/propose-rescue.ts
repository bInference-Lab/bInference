import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type ChainRegistry,
  type PriceSource,
  type RegisteredChain,
  type TxSimulator,
} from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  type IdSource,
  mulDiv,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { planDocument, simulationDocument } from "../intents/intent-documents.schema.js";
import type { IntentProposerRef } from "../intents/intent-record.js";
import { rescueQuoteDocument, rescueRequest } from "../intents/rescue-quote.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { type AdvanceParts, advanceIntent } from "../money-path/advance-intent.js";
import { authorizationCheckOf } from "../money-path/authorization-check-of.js";
import { policyFactsOf } from "../money-path/policy-facts-of.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { PolicyCheck } from "../policy/check-policy.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { InstallStore } from "../ports.js";
import { type CheckedRescue, checkRescueMoves } from "./check-rescue-moves.js";
import { type RescueWallet, rescueMoves } from "./rescue-moves.js";
import { type RescueWalletsParts, rescueWallets } from "./rescue-wallets.js";

/** What a rescue is planned, checked and stored through. */
export interface RescueProposalParts extends RescueWalletsParts {
  readonly stored: StoredIntents;
  readonly install: InstallStore;
  /** Runs each wallet's sends unsent on the rescue's chain. */
  readonly simulator: TxSimulator;
  readonly prices: PriceSource;
  readonly policy: PolicyCheck;
  readonly chains: ChainRegistry;
  /** Whether the engine is locked: the auto test reads it, and a rescue's card asks either way. */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  readonly ids: IdSource;
}

/** A rescue planned and simulated: where it pays, on which chain, and the moves that passed. */
interface Planned {
  readonly rescue: AccountRef;
  readonly chain: RegisteredChain;
  readonly checked: CheckedRescue;
  /** The wallet the intent is stored under: the first that moves something, its agent active. */
  readonly owner: RescueWallet;
}

async function planOf(
  parts: RescueProposalParts,
  signal: AbortSignal,
): Promise<Result<Planned, ProtocolErrorCode>> {
  const facts = await parts.install.read({ signal });
  const { rescueAddress: rescue } = rescueAt(facts, parts.clock.now());
  const chain = rescue === undefined ? undefined : parts.chains.get(accountRefParts(rescue).chain);
  if (rescue === undefined || chain?.ok !== true) {
    return err("rescue.no_address");
  }
  const wallets = await rescueWallets(parts, {
    wallets: facts.wallets,
    chain: chain.value,
    signal,
  });
  const moves = rescueMoves(wallets, nativeAssetOf(chain.value));
  const check = { simulator: parts.simulator, chain: chain.value, clock: parts.clock };
  const checked = await checkRescueMoves(check, { moves, rescue, signal });
  if (checked.moves.length === 0) {
    return err("rescue.nothing_to_move");
  }
  const agents = await parts.agents.list({ signal });
  const active = new Set(
    agents.filter((agent) => agent.archivedAtMs === undefined).map(({ id }) => id),
  );
  const movers = new Set(checked.moves.map(({ from }) => from));
  const owner = wallets.find(({ agentId, account }) => active.has(agentId) && movers.has(account));
  return owner === undefined
    ? err("agent.not_found")
    : ok({ rescue, chain: chain.value, checked, owner });
}

// What the moves are worth now, each rounded down; an asset with no price counts for nothing.
async function valueOf(
  prices: PriceSource,
  amounts: readonly Amount[],
  signal: AbortSignal,
): Promise<bigint> {
  const values = await Promise.all(
    amounts.map(async ({ asset, base }) => {
      const price = await prices.usdPrice(asset, { signal });
      return price.ok ? mulDiv(base, price.value, "down") : 0n;
    }),
  );
  return values.reduce((sum, value) => sum + value, 0n);
}

async function create(
  parts: RescueProposalParts,
  owner: RescueWallet,
  call: { readonly proposerRef: IntentProposerRef; readonly signal: AbortSignal },
): Promise<IntentSnapshot> {
  const machine = createIntentStateMachine({ clock: parts.clock });
  const step = machine.propose({
    kind: "rescue",
    proposer: "owner",
    isPaper: false,
    hasOutsideContent: false,
    agentStatus: "active",
  });
  const intent = { id: parts.ids.next("int"), agentId: owner.agentId, walletId: owner.wallet };
  const created = step.ok
    ? await parts.stored.create(
        { ...intent, request: rescueRequest, proposerRef: call.proposerRef, step: step.value },
        { signal: call.signal },
      )
    : undefined;
  if (created?.ok !== true) {
    throw new BinferenceError({
      code: "engine.rescue_not_stored",
      message: "A new rescue intent could not be stored.",
    });
  }
  return created.value;
}

/** One rescue's run through the money path's steps, and what they read. */
interface Run {
  readonly advance: AdvanceParts;
  readonly planned: Planned;
  readonly wallet: WalletFacts;
}

// The policy judges the rescue's target against the rescue address in effect (decision 0044).
async function checkPolicy(
  parts: RescueProposalParts,
  run: Run,
  snapshot: IntentSnapshot,
): Promise<IntentSnapshot> {
  const { chain, rescue, checked } = run.planned;
  const nowMs = parts.clock.now();
  const nativeAsset = nativeAssetOf(chain);
  const facts = policyFactsOf({
    settings: snapshot.settings,
    wallet: run.wallet,
    chain: chain.ref,
    nativeAsset,
    nowMs,
  });
  const subject = {
    kind: "rescue",
    isPaper: false,
    hasOutsideContent: false,
    outflows: checked.moves.map(({ amount }) => amount),
    inflowAssets: [],
    target: rescue,
  } as const;
  const verdict = await parts.policy.check(
    subject,
    { ...facts, rescueAccount: rescue },
    { signal: run.advance.signal },
  );
  const trigger = verdict.ok
    ? ({ type: "policy_passed" } as const)
    : ({ type: "policy_refused", reason: verdict.error } as const);
  return advanceIntent(run.advance, snapshot, { trigger });
}

// The rescue quotes itself: the moves, their value, and the steps that send them. Its token risk
// does not apply, since nothing is bought; the simulation already ran as the moves were checked.
async function quoteAndCheck(
  parts: RescueProposalParts,
  run: Run,
  checked: IntentSnapshot,
): Promise<IntentSnapshot> {
  const { rescue, checked: moves } = run.planned;
  const quotedAtMs = parts.clock.now();
  const amounts = moves.moves.map(({ amount }) => amount);
  const valueUsdMicros = await valueOf(parts.prices, amounts, run.advance.signal);
  const quote = { rescue, moves: moves.moves, valueUsdMicros, quotedAtMs };
  const fields = {
    quote: rescueQuoteDocument.encode(quote),
    plan: planDocument.encode(moves.drafts),
  };
  const quoted = await advanceIntent(run.advance, checked, {
    trigger: { type: "quote_built", quote: { quotedAtMs } },
    fields,
  });
  if (quoted.record.state !== "quoted") {
    return quoted;
  }
  const assessed = await advanceIntent(run.advance, quoted, { trigger: { type: "risk_passed" } });
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  const simulation = { simulation: simulationDocument.encode(moves.simulation) };
  return advanceIntent(run.advance, assessed, {
    trigger: { type: "simulation_matched" },
    fields: simulation,
  });
}

async function runRescue(
  parts: RescueProposalParts,
  run: Run,
  proposed: IntentSnapshot,
): Promise<IntentSnapshot> {
  const checked = await checkPolicy(parts, run, proposed);
  if (checked.record.state !== "checked") {
    return checked;
  }
  const simulated = await quoteAndCheck(parts, run, checked);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  // The auto test leaves every send kind to the owner, so a rescue always opens its card.
  const trigger = authorizationCheckOf({
    settings: simulated.settings,
    pass: { sellsDeniedToken: false },
    wallet: run.wallet,
    isLocked: parts.isLocked(),
  });
  return advanceIntent(run.advance, simulated, { trigger });
}

/**
 * Plans a rescue of every agent wallet to the rescue address in effect and stores it as one live
 * intent waiting for the owner's tap (decisions 0044 and 0100): it reads what each wallet of the
 * install holds on the rescue address's chain, plans each token whole and the coin above the gas
 * reserve, simulates each wallet's sends and keeps those that ran as planned, then takes the
 * intent through policy, quote, risk and simulation to its card, whatever the agents' modes,
 * freezes and send levels. The intent is stored under the first wallet that moves something and
 * whose agent is active. No rescue address, or one on a chain the registry lacks, is
 * `rescue.no_address`; nothing to move is `rescue.nothing_to_move`; no active agent with a wallet
 * that moves something is `agent.not_found`. None of them stores anything.
 */
export async function proposeRescue(
  parts: RescueProposalParts,
  call: { readonly proposerRef: IntentProposerRef; readonly signal: AbortSignal },
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const { signal } = call;
  const planned = await planOf(parts, signal);
  if (!planned.ok) {
    return planned;
  }
  const { owner } = planned.value;
  const query = { agent: owner.agentId, wallet: owner.wallet, account: owner.account };
  const wallet = await parts.wallets.facts({ ...query, isPaper: false }, { signal });
  const proposed = await create(parts, owner, call);
  const advance = { stored: parts.stored, machine: createIntentStateMachine(parts), signal };
  return ok(await runRescue(parts, { advance, planned: planned.value, wallet }, proposed));
}
