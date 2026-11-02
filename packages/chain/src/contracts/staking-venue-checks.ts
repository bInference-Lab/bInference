import assert from "node:assert/strict";
import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { StakingVenue } from "../staking/ports.js";
import type { StakePlan } from "../staking/stake-plan.js";
import type { LandedStake, StakeRequest, StakingHolding } from "../staking/staking-terms.js";
import type { TxDraft, TxHash } from "../transaction.js";

/**
 * A staking venue under test: `wallet` holds enough of the chain's coin to stake `stake` twice
 * and has nothing staked; `active` is a validator that takes stakes, the pool of a liquid venue,
 * `jailed` one that is jailed, which a liquid venue has none of, and `unknown` no validator at
 * all. `run` lands drafts as the chain would, signed by their
 * sender, and answers their hashes; `wait` moves the chain's time on. `foreign` holds drafts from
 * the wallet that the venue never builds, such as a sibling function, a call to another contract
 * or one naming another account.
 */
export interface StakingVenueSubject {
  readonly venue: StakingVenue;
  readonly wallet: AccountRef;
  readonly active: AccountRef;
  readonly jailed?: AccountRef;
  readonly unknown: AccountRef;
  /** In the chain's coin, at or above the venue's least stake. */
  readonly stake: Amount;
  readonly foreign: readonly TxDraft[];
  run(drafts: readonly TxDraft[]): Promise<readonly TxHash[]>;
  wait(seconds: number): Promise<void>;
}

/** Makes a fresh {@link StakingVenueSubject} for each check. */
export interface StakingVenueHarness {
  create(): Promise<StakingVenueSubject>;
}

/** A signal that never aborts. */
export const live = (): { readonly signal: AbortSignal } => ({
  signal: new AbortController().signal,
});

/** The plan the venue makes for the request; a refusal fails the check. */
export async function planned(
  subject: StakingVenueSubject,
  request: StakeRequest,
): Promise<StakePlan> {
  const plan = await subject.venue.plan(request, live());
  assert.ok(plan.ok, `The venue refused a ${request.action} it should plan.`);
  return plan.value;
}

/** The wallet's one holding; none or more fails the check. */
export async function onlyHolding(subject: StakingVenueSubject): Promise<StakingHolding> {
  const [held, ...rest] = await subject.venue.holdings(subject.wallet, live());
  assert.ok(held !== undefined && rest.length === 0, "The wallet should hold one position.");
  return held;
}

// The venue's decoder reads the staking call as the plan's move, from the wallet and crediting it.
function checkDecoded(subject: StakingVenueSubject, draft: TxDraft, plan: StakePlan): void {
  const read = subject.venue.decode(draft);
  assert.ok(read.ok, "The venue could not decode a call it built.");
  const { credits, action, validator, value, shares, parts, refs } = read.value;
  assert.equal(draft.from, plan.wallet);
  assert.deepEqual(
    [credits, action, validator, value],
    [plan.wallet, plan.action, plan.validator, plan.value.base],
  );
  assert.equal(shares, plan.action === "unstake" ? plan.shares?.base : undefined);
  assert.equal(parts, plan.parts?.length);
  assert.ok(refs === undefined || plan.paper || refs.join() === plan.parts?.join());
}

/**
 * Builds the plan, decodes its staking call and holds it to the plan, from the wallet and
 * crediting it, after the one approval a liquid venue's unstake makes, which no staking decoder
 * reads; lands the drafts; and answers what the venue reads back of the move.
 */
export async function landedPlan(
  subject: StakingVenueSubject,
  plan: StakePlan,
): Promise<LandedStake> {
  const drafts = await subject.venue.build(plan, live());
  const isApproved = subject.venue.pool !== undefined && plan.action === "unstake";
  assert.equal(drafts.length, isApproved ? 2 : 1);
  const [approval] = drafts;
  if (isApproved && approval !== undefined) {
    assert.equal(approval.from, plan.wallet);
    assert.deepEqual(subject.venue.decode(approval), { ok: false, error: "unknown_call" });
  }
  for (const draft of drafts.slice(isApproved ? 1 : 0)) {
    checkDecoded(subject, draft, plan);
  }
  const [hash] = await subject.run(drafts);
  assert.ok(hash !== undefined);
  const { action, wallet, validator } = plan;
  const landed = await subject.venue.landed({ action, wallet, validator, hash }, live());
  assert.ok(landed.ok, `The venue read back no ${action} from its own transaction.`);
  assert.deepEqual([landed.value.action, landed.value.validator], [action, validator]);
  return landed.value;
}

/** Stakes `subject.stake` with the active validator and answers its plan and its read-back. */
export async function staked(
  subject: StakingVenueSubject,
): Promise<{ readonly plan: StakePlan; readonly landed: LandedStake }> {
  const { wallet, active: validator, stake } = subject;
  const plan = await planned(subject, { action: "stake", wallet, validator, amount: stake });
  return { plan, landed: await landedPlan(subject, plan) };
}
