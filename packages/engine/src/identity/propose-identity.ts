import { type TxDraft, type TxSimulator, isSameAccount } from "@binference/chain";
import { err, type IdSource, ok, type Result } from "@binference/core";
import type {
  ProtocolErrorCode,
  RegisterIdentityRequest,
  SimulationView,
} from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { identityQuoteDocument } from "../intents/identity-quote.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import { callsOutsideCeiling } from "../limits/limit-ceiling.js";
import { type AdvanceParts, advanceIntent } from "../money-path/advance-intent.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { startProposal, storeProposed } from "../money-path/store-proposed.js";
import type { AgentStore } from "../ports.js";
import { checkTransferPolicy, type TransferPolicyParts } from "../sends/check-transfer-policy.js";
import { advanceBySimulation, advanceByVerdict, runToCard } from "../sends/owner-steps.js";
import {
  type IdentityResolveOptions,
  type ResolvedIdentity,
  resolveIdentity,
} from "./resolve-identity.js";

/** What an identity registration is resolved, checked, simulated and stored through. */
export interface IdentityPathOptions extends IdentityResolveOptions, TransferPolicyParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** Runs the registration's call unsent on its chain; a paper registration never gets this far. */
  readonly simulator: TxSimulator;
  /** Whether the engine is locked; a registration opens its card either way. */
  readonly isLocked: () => boolean;
  readonly ids: IdSource;
}

/** One registration's run through its steps, and what they read. */
interface IdentityRun {
  readonly options: IdentityPathOptions;
  readonly advance: AdvanceParts;
  readonly resolved: ResolvedIdentity;
}

/** A registration's quote and its one call. */
interface PlannedIdentity {
  readonly file: string;
  readonly draft: TxDraft;
}

// The policy judges a registration as a move of nothing: `paper_only` in paper mode and `frozen` for
// a frozen agent. No venue rule judges it: the owner's opt-in, which writes the registry's call
// into the main wallet's ceiling with the owner key, is what lets the agent register.
async function judge(run: IdentityRun, proposed: IntentSnapshot) {
  const { options, resolved, advance } = run;
  const judged = {
    status: proposed.stored.status,
    settings: resolved.settings,
    facts: resolved.facts,
    chain: resolved.chain,
    nativeAsset: nativeAssetOf(resolved.chain),
  };
  const verdict = await checkTransferPolicy(options, judged, advance.signal);
  return advanceByVerdict(advance, proposed, verdict);
}

// The registry's version, then the wallet's stored ceiling, then the call the host holds to the
// file and the wallet (decision 0335).
function planOf(run: IdentityRun): Result<PlannedIdentity, QuoteFailure> {
  const { options, resolved } = run;
  const { registry, standing, walletRecord, card, account } = resolved;
  if (standing === undefined) {
    return err("venue_down");
  }
  if (standing.version !== registry.testedVersion) {
    return err("registry_changed");
  }
  const calls = options.identity.callsOf(registry);
  if (walletRecord === undefined || callsOutsideCeiling(walletRecord, calls).length > 0) {
    return err("identity_ceiling");
  }
  const file = registry.fileOf(card);
  const built = options.identity.build(registry, { wallet: account, file });
  return built.ok ? ok({ file, draft: built.value }) : built;
}

// The registration's one step runs unsent: it succeeds, nothing leaves the wallet but its gas, it
// sets no allowance, and the registry mints one identity token to the wallet.
async function simulateRegistration(
  run: IdentityRun,
  draft: TxDraft,
): Promise<Result<SimulationView, SimulationFailure>> {
  const { options, resolved, advance } = run;
  const [step] = await options.simulator.simulate([draft], { signal: advance.signal });
  if (step?.status !== "success") {
    return err("simulation_reverted");
  }
  const { family } = resolved.chain;
  const isQuiet =
    step.transfers.every(({ from }) => !isSameAccount(from, resolved.account, family)) &&
    step.approvals.length === 0;
  const minted = options.identity.minted(resolved.registry, step, resolved.account);
  return isQuiet && minted === 1
    ? ok({ spent: [], received: [], simulatedAt: options.clock.now() })
    : err("effects_differ");
}

// The step's quote and plan, then its simulation; risk weighs no token here.
async function quoteAndSimulate(
  run: IdentityRun,
  checked: IntentSnapshot,
): Promise<IntentSnapshot> {
  const { options, advance, resolved } = run;
  const planned = planOf(run);
  if (!planned.ok) {
    return advanceIntent(advance, checked, {
      trigger: { type: "quote_failed", reason: planned.error },
    });
  }
  const { registry, card } = resolved;
  const quotedAtMs = options.clock.now();
  const quote = {
    registry: registry.registry,
    venue: registry.id,
    ...card,
    file: planned.value.file,
    quotedAtMs,
  };
  const fields = {
    quote: identityQuoteDocument.encode(quote),
    plan: planDocument.encode([planned.value.draft]),
  };
  const trigger = { type: "quote_built", quote: { quotedAtMs } } as const;
  const quoted = await advanceIntent(advance, checked, { trigger, fields });
  if (quoted.record.state !== "quoted") {
    return quoted;
  }
  const assessed = await advanceIntent(advance, quoted, { trigger: { type: "risk_passed" } });
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  return advanceBySimulation(
    advance,
    assessed,
    await simulateRegistration(run, planned.value.draft),
  );
}

// The owner's registration and who proposes it.
interface IdentityProposing {
  readonly request: RegisterIdentityRequest;
  readonly proposer: Proposer;
}

/**
 * Proposes an identity registration (decision 0335): it resolves the registry, the agent's main
 * wallet and the card's fields, refusing an agent that has an identity before anything is stored,
 * stores the intent, judges it by the policy (`paper_only` in paper mode), holds the registry to
 * the version binference was tested with (`registry_changed`) and the wallet's ceiling to its call
 * (`identity_ceiling`), builds and checks the call, simulates it and opens its card, which lasts
 * 10 minutes and never passes the auto test. A request that cannot become an intent is a protocol
 * error code and stores nothing.
 */
export async function proposeIdentity(
  options: IdentityPathOptions,
  proposing: IdentityProposing,
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const started = await startProposal(options, proposing, signal);
  if (!started.ok) {
    return started;
  }
  const { machine, settings, proposal, step } = started.value;
  const { request } = proposing;
  const resolving = { request, settings, isPaper: proposal.isPaper, signal };
  const resolved = await resolveIdentity(options, resolving);
  if (!resolved.ok) {
    return resolved;
  }
  const intent = { ...proposing, step, wallet: resolved.value.wallet, assets: {} };
  const created = await storeProposed(options, intent, signal);
  const advance = { stored: options.stored, machine, signal };
  const run = { options, advance, resolved: resolved.value };
  return ok(
    await runToCard(advance, {
      judge: async () => judge(run, created),
      simulate: async (checked) => quoteAndSimulate(run, checked),
      wallet: resolved.value.facts,
      isLocked: options.isLocked,
    }),
  );
}
