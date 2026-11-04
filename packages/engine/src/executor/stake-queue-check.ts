import {
  type AccountRef,
  accountRefParts,
  type AllowedTargets,
  accountRefSchema,
  declaredContracts,
  type RegisteredChain,
  type VenueDeclaration,
} from "@binference/chain";
import type { StakePlan, StakeRefusal, StakeRequest } from "@binference/chain/staking";
import type { Ok } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { ReasonNamed } from "../intents/event-cause.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type StakeIntentQuote, stakeQuoteDocument } from "../intents/stake-quote.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { checkTransferPolicy } from "../sends/check-transfer-policy.js";
import { ownCapCallOf } from "../staking/stake-ceiling.js";
import { declaredSpenders } from "../venues/declared-spenders.js";
import { claimMismatch } from "../venues/stake-plan-checks.js";
import type { StakingHost } from "../venues/staking-host.js";
import { declaredTargetsOf } from "./declared-calls.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import type { TransferRecheckParts } from "./transfer-queue-check.js";

/** A staking move's quote, when the intent is a stake that has one. */
export function stakeQuoteOf(record: IntentRecord): StakeIntentQuote | undefined {
  return record.kind === "stake" && record.quote !== undefined
    ? stakeQuoteDocument.decode(record.quote)
    : undefined;
}

/**
 * What the signer may let a staking move's calls reach (spec 5, section 5.2): the contracts its
 * venue declares on the chain, read from the registry by name, and only the functions it declares
 * there; no recipient, since a staking call pays no one; and no spender, but the venue's declared
 * spenders for an unstake whose plan burns receipt units it approves first (decision 0331). A
 * venue the engine does not run gives no contract, so nothing signs.
 */
export function stakeTargetsOf(
  quote: StakeIntentQuote,
  context: {
    readonly chain: RegisteredChain;
    readonly venues: readonly VenueDeclaration[];
    readonly staking?: StakingHost;
  },
): AllowedTargets {
  const { chain, venues, staking } = context;
  const venue = staking?.venueOn(quote.venue, chain.ref);
  const used: readonly VenueDeclaration[] = venue === undefined ? [] : [venue];
  const declared = venue === undefined ? undefined : declaredContracts(venue, chain);
  const contracts: readonly AccountRef[] =
    declared?.ok === true
      ? declared.value.map((address) => accountRefSchema.parse(`${chain.ref}:${address}`))
      : [];
  const targets = declaredTargetsOf(chain, { used, all: [...venues, ...used] });
  const isApproved = venue?.pool !== undefined && quote.plan.action === "unstake";
  const spenders = venue === undefined || !isApproved ? [] : declaredSpenders(venue, chain);
  return { contracts, spenders, recipients: [], ...targets };
}

/** What the queue reads as it checks a staking move again. */
export interface StakeRecheckParts extends TransferRecheckParts {
  readonly staking?: StakingHost;
}

/**
 * The policy run again on a confirmed staking move as the wallet queue takes it (spec 6,
 * `queue_took`): a stake's coin against the caps with the wallet's facts now, its own outflow left
 * out, an unstake and a claim against none, and the venue the agent's limits allow now.
 */
export async function recheckStake(
  snapshot: IntentSnapshot,
  parts: StakeRecheckParts,
  signal: AbortSignal,
): Promise<{ readonly hasPassed: boolean; readonly networkFeeCapNativeBase?: bigint }> {
  const { record, settings, stored } = snapshot;
  const quote = stakeQuoteOf(record);
  if (quote === undefined) {
    return { hasPassed: false };
  }
  const chain = parts.chains.get(accountRefParts(quote.plan.wallet).chain);
  const venue = chain.ok ? parts.staking?.venueOn(quote.venue, chain.value.ref) : undefined;
  if (!chain.ok || venue === undefined) {
    return { hasPassed: false };
  }
  const { plan } = quote;
  const query = { agent: record.agentId, wallet: record.walletId, account: plan.wallet };
  const facts = await parts.wallets.facts(
    { ...query, isPaper: false, intent: record.id },
    { signal },
  );
  const own = ownCapCallOf(venue, chain.value.ref);
  const judged = {
    status: stored.status,
    settings,
    facts: own === undefined ? facts : { ...facts, ceilingPerTxNativeBase: own.maxValueBase },
    chain: chain.value,
    nativeAsset: nativeAssetOf(chain.value),
    venue: venue.id,
    ...(plan.action === "stake" ? { outflow: plan.value } : {}),
  };
  const verdict = await checkTransferPolicy(parts, judged, signal);
  return { hasPassed: verdict.ok, networkFeeCapNativeBase: facts.networkFeeCapNativeBase };
}

/**
 * What the queue does with a confirmed intent after a staking move was planned again: sign it
 * (`go`, also for any intent that is no staking move), wait for the next block because the venue
 * did not answer (`unread`), or nothing more, since the venue refused it and it ended (`ended`).
 */
export type StakeTake = "go" | "unread" | "ended";

// The move planned again as the card confirmed it: a stake of its coin, an unstake of the whole
// stake, which says how many receipt units the wallet holds now, or a claim; each names the
// validator, a liquid venue's pool, the card's plan named.
function requestOf(quote: StakeIntentQuote): StakeRequest {
  const { action, wallet, validator, value } = quote.plan;
  if (action === "stake") {
    return { action, wallet, validator, amount: value };
  }
  return action === "unstake"
    ? { action, wallet, validator, amount: "whole" }
    : { action, wallet, validator };
}

async function endRefused(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  refused: { readonly reason: StakeRefusal | "decode_mismatch"; readonly named?: ReasonNamed },
): Promise<StakeTake> {
  const { reason, named } = refused;
  const trigger = { type: "stake_refused", reason } as const;
  await moveIntent(run, snapshot, named === undefined ? trigger : { trigger, named });
  run.parts.log.warn("executor.stake_refused", { intentId: snapshot.record.id });
  return "ended";
}

/** Why a staking move planned again ends: the venue's refusal or the host's, with its facts. */
interface Refused {
  readonly ok: false;
  readonly refused: {
    readonly reason: StakeRefusal | "decode_mismatch";
    readonly named?: ReasonNamed;
  };
}

// The move planned again now, or why it ends: the venue's refusal with the facts its words name,
// or another move than the card's; `undefined` while the venue does not answer or the engine does
// not run it.
async function replanOf(
  run: ExecutionRun,
  quote: StakeIntentQuote,
): Promise<Ok<StakePlan> | Refused | undefined> {
  const { staking } = run.parts;
  const venue = staking?.venueOn(quote.venue, run.plan.chain.ref);
  if (staking === undefined || venue === undefined) {
    return undefined;
  }
  const planned = await staking.plan(venue, requestOf(quote), { signal: run.signal });
  if (planned.ok) {
    return planned;
  }
  if (planned.error === "venue_down") {
    return undefined;
  }
  const reason = planned.error;
  const { facts } = planned;
  return { ok: false, refused: facts === undefined ? { reason } : { reason, named: facts } };
}

/**
 * Plans a confirmed staking move again as its wallet's queue takes it, before any signature
 * (decision 0327), since a validator can be jailed, the venue paused or the stake moved between
 * the card and the queue: a refusal ends the move `failed_check` with the venue's reason and the
 * facts its words name, a plan of another move than the card's with `decode_mismatch`, as is a
 * stake that would mint fewer receipt units than its card promised (decision 0331), a claim of a
 * part the wallet no longer holds ready `nothing_to_claim`, and an unstake of more receipt units
 * than the wallet now holds `exceeds_staked`; a venue that does not
 * answer, or one the engine does not run, signs nothing and waits for the next block. Any other
 * intent goes on.
 */
export async function takeStake(run: ExecutionRun, snapshot: IntentSnapshot): Promise<StakeTake> {
  const quote = stakeQuoteOf(snapshot.record);
  if (quote === undefined) {
    return "go";
  }
  const planned = await replanOf(run, quote);
  if (planned === undefined) {
    run.parts.log.warn("executor.stake_unread", { intentId: snapshot.record.id });
    return "unread";
  }
  if (!planned.ok) {
    return endRefused(run, snapshot, planned.refused);
  }
  if (mintsFewer(quote.plan, planned.value)) {
    return endRefused(run, snapshot, { reason: "decode_mismatch" });
  }
  const gone = await cardPartsGone(run, quote);
  if (gone !== false) {
    return gone === undefined
      ? "unread"
      : endRefused(run, snapshot, { reason: "nothing_to_claim" });
  }
  return burnsMore(quote.plan, planned.value)
    ? endRefused(run, snapshot, { reason: "exceeds_staked" })
    : "go";
}

// Whether a claim's card names a part the wallet no longer holds ready, such as one claimed outside
// binference since (decision 0331); `undefined` while the venue does not answer.
async function cardPartsGone(
  run: ExecutionRun,
  quote: StakeIntentQuote,
): Promise<boolean | undefined> {
  const { staking } = run.parts;
  const venue = staking?.venueOn(quote.venue, run.plan.chain.ref);
  const { plan } = quote;
  if (plan.action !== "claim" || staking === undefined || venue === undefined) {
    return false;
  }
  const held = await staking.parts(
    venue,
    { wallet: plan.wallet, validator: plan.validator },
    { signal: run.signal },
  );
  return held.ok ? claimMismatch(plan, held.value) !== undefined : undefined;
}

// Whether the card's stake would now mint fewer receipt units than the least its card promised.
function mintsFewer(confirmed: StakePlan, now: StakePlan): boolean {
  const least = confirmed.minShares?.base;
  return least !== undefined && (now.shares?.base ?? 0n) < least;
}

// Whether the card's unstake burns more receipt units than the wallet holds by the new plan.
function burnsMore(confirmed: StakePlan, now: StakePlan): boolean {
  const burned = confirmed.action === "unstake" ? (confirmed.shares?.base ?? 0n) : 0n;
  return burned > (now.shares?.base ?? 0n);
}
