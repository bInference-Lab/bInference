import type { TxDraft } from "@binference/chain";
import type { StakePlan } from "@binference/chain/staking";
import { err, ok, type Result } from "@binference/core";
import type { CeilingEditor } from "../install/ports.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { PolicyRejection, QuoteFailure } from "../intents/intent-reason.js";
import { stakeQuoteDocument } from "../intents/stake-quote.js";
import { type AdvanceParts, advanceIntent } from "../money-path/advance-intent.js";
import type { PolicyPass, PolicyVerdict } from "../policy/check-policy.js";
import { checkTransferPolicy, type TransferPolicyParts } from "../sends/check-transfer-policy.js";
import { advanceByVerdict } from "../sends/owner-steps.js";
import type { HostPlanned, StakingHost } from "../venues/staking-host.js";
import { refusalNamedOf } from "./refusal-named.js";
import type { ResolvedStake } from "./resolve-stake.js";
import { ownCapCallOf, storedStakeCap } from "./stake-ceiling.js";

/** What a staking move's policy and quote steps read. */
export interface StakeStepParts extends TransferPolicyParts {
  readonly staking: StakingHost;
  /** Reads a wallet's stored copy of its ceiling, with no call to custody. */
  readonly ceilings: Pick<CeilingEditor, "readStored">;
}

/** One staking move's run: its parts, how it moves, what it resolved and what its venue planned. */
export interface StakeRun {
  readonly parts: StakeStepParts;
  readonly advance: AdvanceParts;
  readonly resolved: ResolvedStake;
  readonly planned: HostPlanned;
}

// The policy judges a stake by the venue's own cap on its call, where it declares one (decision
// 0325): the stored ceiling's cap is a check of its own, whose words say how to raise it. A stake
// sends exactly its amount, which the caps count; an unstake and a claim send nothing.
async function verdictOf(run: StakeRun, proposed: IntentSnapshot): Promise<PolicyVerdict> {
  const { parts, resolved, advance } = run;
  const { ask, venue, chain, facts } = resolved;
  const own = ownCapCallOf(venue, chain.ref);
  const capped = own === undefined ? facts : { ...facts, ceilingPerTxNativeBase: own.maxValueBase };
  const judged = {
    status: proposed.stored.status,
    settings: resolved.settings,
    facts: capped,
    chain,
    nativeAsset: resolved.nativeAsset,
    venue: venue.id,
    ...(ask.action === "stake" ? { outflow: ask.amount } : {}),
  };
  return checkTransferPolicy(parts, judged, advance.signal);
}

/**
 * The policy step of a staking move (spec 6, sections 4 and 5): the caps count a stake's value,
 * never an unstake's or a claim's, and a stake its venue refuses for a jailed validator ends
 * `rejected_policy` with `validator_jailed`, after every rule spec 6 lists before it.
 */
export async function judgeStake(
  run: StakeRun,
  proposed: IntentSnapshot,
): Promise<{ readonly snapshot: IntentSnapshot; readonly pass?: PolicyPass }> {
  const verdict = await verdictOf(run, proposed);
  const isJailed = !run.planned.ok && run.planned.error === "validator_jailed";
  const isEarlier = !verdict.ok && verdict.error !== "no_price";
  if (!isJailed || isEarlier) {
    return advanceByVerdict(run.advance, proposed, verdict);
  }
  const reason: PolicyRejection = "validator_jailed";
  const trigger = { type: "policy_refused", reason } as const;
  return { snapshot: await advanceIntent(run.advance, proposed, { trigger }) };
}

// A stake above what the wallet's stored ceiling lets one stake carry, as a ceiling written before
// decision 0325 holds every stake to the cap per call, is refused before the card.
function ceilingRefusal(run: StakeRun, plan: StakePlan): QuoteFailure | undefined {
  const { resolved, parts } = run;
  const { walletRecord, venue, chain, facts } = resolved;
  const policy = walletRecord?.ceiling.policy;
  const read = policy === undefined ? undefined : parts.ceilings.readStored(policy);
  const cap = storedStakeCap(read, ownCapCallOf(venue, chain.ref), facts.ceilingPerTxNativeBase);
  return plan.value.base > cap ? "stake_over_ceiling" : undefined;
}

/** A staking move's plan held to the host's checks, and the call it builds. */
export interface BuiltStake {
  readonly plan: StakePlan;
  readonly steps: readonly TxDraft[];
}

// The plan, the wallet's ceiling, then the build the host holds to the plan.
async function buildStake(run: StakeRun): Promise<Result<BuiltStake, QuoteFailure>> {
  const { planned, parts, resolved, advance } = run;
  if (!planned.ok) {
    // A jailed validator ended at the policy step; any other refusal is the venue's check reason.
    return err(planned.error === "validator_jailed" ? "no_route" : planned.error);
  }
  const refusal = ceilingRefusal(run, planned.value);
  if (refusal !== undefined) {
    return err(refusal);
  }
  const built = await parts.staking.build(resolved.venue, planned.value, {
    signal: advance.signal,
  });
  return built.ok ? ok({ plan: planned.value, steps: built.value }) : err(built.error);
}

/**
 * The quote step of a staking move (decision 0327): its venue's plan, checked against the wallet's
 * stored ceiling and built into its one call, which the host holds to the plan. The intent stores
 * the plan, which carries the validator's yearly rate, as its quote, so the card's terms hash binds
 * it, the call as its plan, and a stake's value, which the rolling cap counts once it is confirmed.
 * A venue's refusal ends the intent with the facts its words name, kept in the event's cause, with
 * a liquid venue's pool.
 */
export async function quoteStake(
  run: StakeRun,
  checked: IntentSnapshot,
  pass: PolicyPass,
): Promise<{ readonly snapshot: IntentSnapshot; readonly built?: BuiltStake }> {
  const { parts, resolved, advance } = run;
  const built = await buildStake(run);
  if (!built.ok) {
    const trigger = { type: "quote_failed", reason: built.error } as const;
    const named = await refusalNamedOf(run);
    const move = { trigger, ...(named === undefined ? {} : { named }) };
    return { snapshot: await advanceIntent(advance, checked, move) };
  }
  const { plan, steps } = built.value;
  const liquid = resolved.venue.pool === undefined ? {} : { liquid: true as const };
  const quote = { venue: resolved.venue.id, plan, ...liquid };
  const value = plan.action === "stake" ? pass.figures?.valueUsdMicros : undefined;
  const fields = {
    quote: stakeQuoteDocument.encode(quote),
    plan: planDocument.encode(steps),
    ...(value === undefined ? {} : { valueUsdMicros: value }),
  };
  const trigger = { type: "quote_built", quote: { quotedAtMs: parts.clock.now() } } as const;
  const quoted = await advanceIntent(advance, checked, { trigger, fields });
  return quoted.record.state === "quoted"
    ? { snapshot: quoted, built: built.value }
    : { snapshot: quoted };
}
