import type { TxSimulator } from "@binference/chain";
import { type IdSource, ok, type Result } from "@binference/core";
import type { AssetInfos, ProtocolErrorCode, StakeRequest } from "@binference/protocol";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { advanceIntent } from "../money-path/advance-intent.js";
import { authorizationCheckOf } from "../money-path/authorization-check-of.js";
import type { Proposer } from "../money-path/create-money-path.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import { startProposal, storeProposed } from "../money-path/store-proposed.js";
import { type ReadTokenFacts, unlistedAssetInfos } from "../money-path/token-facts.js";
import type { PolicyPass } from "../policy/check-policy.js";
import type { AgentStore } from "../ports.js";
import { advanceBySimulation } from "../sends/owner-steps.js";
import { type StakePlanParts, planStakeMove } from "./plan-stake-move.js";
import { type ResolvedStake, resolveStake, type StakeResolveOptions } from "./resolve-stake.js";
import { paperStakeView, simulateStake } from "./simulate-stake.js";
import {
  type BuiltStake,
  judgeStake,
  quoteStake,
  type StakeRun,
  type StakeStepParts,
} from "./stake-steps.js";

/** What a staking move is resolved, planned, checked, simulated, authorized and run through. */
export interface StakePathOptions extends StakeResolveOptions, StakePlanParts, StakeStepParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** Runs a live move's call unsent on its chain; a paper move runs nothing. */
  readonly simulator: TxSimulator;
  /** The rolling cap each confirmation is checked against, one agent's at a time. */
  readonly gate: CapGate;
  /** Whether the engine is locked: no live move is authorized by auto mode while it is. */
  readonly isLocked: () => boolean;
  readonly execute: ExecuteConfirmed;
  readonly ids: IdSource;
  /** Reads a receipt token's own symbol, name and decimals when the registry lists none. */
  readonly readTokenFacts: ReadTokenFacts;
}

// What the receipt token a stake mints or an unstake burns says of itself, which its receipt and
// positions name it by (decision 0199); a claim books none. A validator the venue cannot name
// leaves nothing to read: the plan then ends the intent with the venue's reason.
async function receiptInfos(
  options: StakePathOptions,
  resolved: ResolvedStake,
  signal: AbortSignal,
): Promise<Result<AssetInfos, "asset.unreadable">> {
  const { venue, ask } = resolved;
  if (ask.action === "claim") {
    return ok({});
  }
  const receipt = await options.staking.receipt(venue, ask.validator, { signal });
  return receipt.ok ? unlistedAssetInfos(options, [receipt.value], signal) : ok({});
}

// A live move's call runs unsent; a paper move runs nothing, and its view is its paper plan.
async function simulate(
  run: StakeRun & { readonly options: StakePathOptions },
  quoted: IntentSnapshot,
  built: BuiltStake,
): Promise<IntentSnapshot> {
  const { advance, options, resolved } = run;
  const assessed = await advanceIntent(advance, quoted, { trigger: { type: "risk_passed" } });
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  const nowMs = () => options.clock.now();
  const simulation = assessed.record.isPaper
    ? ok(paperStakeView(built.plan, nowMs()))
    : await simulateStake(
        { simulator: options.simulator, family: resolved.chain.family, nowMs },
        built,
        advance.signal,
      );
  return advanceBySimulation(advance, assessed, simulation);
}

// The auto test at `simulated`, in the agent's line of confirmations (decision 0136): a stake within
// the caps and a claim may skip the card, an unstake never does (decision 0296).
async function authorize(
  run: StakeRun & { readonly options: StakePathOptions },
  simulated: IntentSnapshot,
  pass: PolicyPass,
): Promise<IntentSnapshot> {
  const { options, advance, resolved } = run;
  const { gate, isLocked } = options;
  return gate.serially(simulated.record.agentId, async () => {
    const spent = await gate.spent(simulated, { signal: advance.signal });
    const figures =
      pass.figures === undefined
        ? {}
        : { figures: { ...pass.figures, rollingDaySpentUsdMicros: spent } };
    const trigger = authorizationCheckOf({
      settings: simulated.settings,
      pass: { ...pass, ...figures },
      wallet: resolved.facts,
      isLocked: isLocked() && !simulated.record.isPaper,
      hasUnlistedSpender: false,
      stake: { isUnstake: resolved.ask.action === "unstake" },
    });
    return advanceIntent(advance, simulated, { trigger });
  });
}

// Plan, policy, quote and build, simulation, the auto test or the card, then the execute step for
// a move the auto mode confirmed.
async function runStake(
  run: StakeRun & { readonly options: StakePathOptions },
  proposed: IntentSnapshot,
): Promise<IntentSnapshot> {
  const judged = await judgeStake(run, proposed);
  if (judged.pass === undefined) {
    return judged.snapshot;
  }
  const quoted = await quoteStake(run, judged.snapshot, judged.pass);
  if (quoted.built === undefined) {
    return quoted.snapshot;
  }
  const simulated = await simulate(run, quoted.snapshot, quoted.built);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  const authorized = await authorize(run, simulated, judged.pass);
  return run.options.execute(authorized, { signal: run.advance.signal });
}

/**
 * Proposes a stake, an unstake or a claim (spec 6, section 5; decision 0327): it resolves the
 * venue, the validator's chain and the agent's wallet, stores the intent, plans the move through
 * the venue host, a paper one against its paper position, then judges it by the policy, the caps
 * counting a stake's value alone, ends one the venue refuses with the venue's reason, and one
 * above the wallet's stored ceiling with `stake_over_ceiling`, builds and checks its call,
 * simulates a live one and meets the auto test, or opens its card for 10 minutes. A request that
 * cannot become an intent is a protocol error code and stores nothing.
 */
export async function proposeStake(
  options: StakePathOptions,
  call: { readonly request: StakeRequest; readonly proposer: Proposer },
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const started = await startProposal(options, call, signal);
  if (!started.ok) {
    return started;
  }
  const { machine, settings, step } = started.value;
  const { isPaper } = started.value.proposal;
  const resolved = await resolveStake(options, {
    request: call.request,
    settings,
    isPaper,
    signal,
  });
  if (!resolved.ok) {
    return resolved;
  }
  const assets = await receiptInfos(options, resolved.value, signal);
  if (!assets.ok) {
    return assets;
  }
  const intent = { ...call, step, wallet: resolved.value.wallet, assets: assets.value };
  const created = await storeProposed(options, intent, signal);
  const advance = { stored: options.stored, machine, signal };
  const planned = await planStakeMove(options, resolved.value, { isPaper, signal });
  const run = { options, parts: options, advance, resolved: resolved.value, planned };
  return ok(await runStake(run, created));
}
