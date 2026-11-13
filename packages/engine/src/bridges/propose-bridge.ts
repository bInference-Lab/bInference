import type { TxSimulator } from "@binference/chain";
import { err, type IdSource, ok, type Result } from "@binference/core";
import type { AssetInfos, BridgeRequest, ProtocolErrorCode } from "@binference/protocol";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import { type AdvanceParts, advanceIntent } from "../money-path/advance-intent.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { startProposal, storeProposed } from "../money-path/store-proposed.js";
import type { PolicyPass } from "../policy/check-policy.js";
import type { AgentStore } from "../ports.js";
import type { ProposalQuotaParts } from "../quotas/install-quotas.js";
import { checkTransferPolicy, type TransferPolicyParts } from "../sends/check-transfer-policy.js";
import { advanceBySimulation, advanceByVerdict, runToCard } from "../sends/owner-steps.js";
import { type BridgeCheckParts, bridgeRefusal } from "./bridge-checks.js";
import { type BuiltBridge, buildBridge } from "./build-bridge.js";
import { chooseBridge } from "./choose-bridge.js";
import { type BridgeResolveOptions, type ResolvedBridge, resolveBridge } from "./resolve-bridge.js";
import { simulateBridge } from "./simulate-bridge.js";

/** What a bridge is resolved, checked, quoted, simulated and stored through. */
export interface BridgePathOptions
  extends BridgeResolveOptions, BridgeCheckParts, TransferPolicyParts, ProposalQuotaParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** Runs the steps unsent on their chain, live balances only: a paper bridge never gets this far. */
  readonly simulator: TxSimulator;
  /** Whether the engine is locked; a bridge opens its card either way. */
  readonly isLocked: () => boolean;
  readonly ids: IdSource;
}

/** One bridge's run through its steps, and what they read. */
interface BridgeRun {
  readonly options: BridgePathOptions;
  readonly advance: AdvanceParts;
  readonly resolved: ResolvedBridge;
}

// The policy judges a bridge as a send to its payee on another chain (decision 0067), with the
// venue a route would take when the agent's limits allow none.
async function judge(
  run: BridgeRun,
  proposed: IntentSnapshot,
): Promise<{ readonly snapshot: IntentSnapshot; readonly pass?: PolicyPass }> {
  const { resolved, options, advance } = run;
  const { payee } = resolved;
  const judged = {
    status: proposed.stored.status,
    settings: resolved.settings,
    facts: resolved.facts,
    chain: resolved.chain,
    nativeAsset: nativeAssetOf(resolved.chain),
    outflow: resolved.amount,
    target: payee.account,
    ...(payee.rescueHome === undefined ? {} : { rescueAccount: payee.account }),
    ...(resolved.offVenue === undefined ? {} : { venue: resolved.offVenue }),
  };
  return advanceByVerdict(
    advance,
    proposed,
    await checkTransferPolicy(options, judged, advance.signal),
  );
}

// The checks before the quote, then the routes' quotes and the chosen route's build.
async function planBridge(run: BridgeRun): Promise<Result<BuiltBridge, QuoteFailure>> {
  const { options, resolved, advance } = run;
  const refusal = await bridgeRefusal(options, resolved, advance.signal);
  if (refusal !== undefined) {
    return err(refusal);
  }
  const chosen = await chooseBridge(options, resolved, advance.signal);
  return chosen.ok
    ? buildBridge(options, resolved, { chosen: chosen.value, signal: advance.signal })
    : chosen;
}

// The bridge's plan and its quote, with the value the caps counted.
async function quote(
  run: BridgeRun,
  checked: IntentSnapshot,
  pass: PolicyPass,
): Promise<{ readonly snapshot: IntentSnapshot; readonly built?: BuiltBridge }> {
  const { options, advance } = run;
  const built = await planBridge(run);
  if (!built.ok) {
    const trigger = { type: "quote_failed", reason: built.error } as const;
    return { snapshot: await advanceIntent(advance, checked, { trigger }) };
  }
  const { figures } = pass;
  const fields = {
    quote: bridgeQuoteDocument.encode(built.value.quote),
    plan: planDocument.encode(built.value.steps),
    ...(figures === undefined ? {} : { valueUsdMicros: figures.valueUsdMicros }),
  };
  const trigger = { type: "quote_built", quote: { quotedAtMs: options.clock.now() } } as const;
  return {
    snapshot: await advanceIntent(advance, checked, { trigger, fields }),
    built: built.value,
  };
}

// The bridge's simulation: it buys nothing, so no token risk weighs it.
async function simulate(
  run: BridgeRun,
  checked: IntentSnapshot,
  pass: PolicyPass,
): Promise<IntentSnapshot> {
  const { options, advance, resolved } = run;
  const quoted = await quote(run, checked, pass);
  if (quoted.built === undefined || quoted.snapshot.record.state !== "quoted") {
    return quoted.snapshot;
  }
  const assessed = await advanceIntent(advance, quoted.snapshot, {
    trigger: { type: "risk_passed" },
  });
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  const parts = { simulator: options.simulator, nowMs: () => options.clock.now() };
  const planned = { bridge: resolved, ...quoted.built };
  return advanceBySimulation(
    advance,
    assessed,
    await simulateBridge(parts, planned, advance.signal),
  );
}

// Policy, the checks before the quote, quote, build, simulation, then the card: the auto test
// leaves every bridge to the owner's tap (spec 6, section 5).
async function runBridge(run: BridgeRun, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  return runToCard(run.advance, {
    judge: async () => judge(run, proposed),
    simulate: async (checked, pass) => simulate(run, checked, pass),
    wallet: run.resolved.facts,
    isLocked: run.options.isLocked,
  });
}

// The destination chain's info of what each route the wallet may take delivers, which no registry
// of the engine's own chains lists, so the intent keeps it for its cards and views.
function deliveredInfos(resolved: ResolvedBridge): AssetInfos {
  const { assets } = resolved.destination;
  const delivered = resolved.candidates.flatMap(({ route }) =>
    route.coin === undefined ? [route.arrives] : [route.arrives, route.coin],
  );
  return Object.fromEntries(
    delivered.flatMap((asset) => {
      const info = assets[asset];
      return info === undefined ? [] : [[asset, info]];
    }),
  );
}

/**
 * Proposes a bridge (spec 6, section 5; decisions 0297, 0318 and 0319): it resolves who it pays on
 * the destination chain, the routes and the wallet they run from, stores the intent, judges it by
 * the policy (the send level, the address book, the caps, the venue, and `paper_only` in paper
 * mode), checks the ceiling pays the recipient, the wallet holds the amount and the payee's code,
 * quotes every route and builds the best, simulates it and opens its card, which lasts 10 minutes
 * and never passes the auto test. A request that cannot become an intent is a protocol error code
 * and stores nothing.
 */
export async function proposeBridge(
  options: BridgePathOptions,
  call: { readonly request: BridgeRequest; readonly proposer: Proposer },
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const started = await startProposal(options, call, signal);
  if (!started.ok) {
    return started;
  }
  const { machine, settings, proposal, step } = started.value;
  const resolved = await resolveBridge(options, {
    request: call.request,
    settings,
    isPaper: proposal.isPaper,
    signal,
  });
  if (!resolved.ok) {
    return resolved;
  }
  const assets = deliveredInfos(resolved.value);
  const created = await storeProposed(
    options,
    { ...call, step, wallet: resolved.value.wallet, assets },
    signal,
  );
  const advance = { stored: options.stored, machine, signal };
  return ok(await runBridge({ options, advance, resolved: resolved.value }, created));
}
