import { type ChainFamily, isSameAccount } from "@binference/chain";
import type { LandedStake, StakePlan } from "@binference/chain/staking";

/**
 * Why the venue host refused what a staking venue read back of a landed move, against the plan the
 * card confirmed (decision 0327): `other_move` another action or validator; `other_coin` coin of
 * another asset, or a stake that put in other than the coin its call sent; `other_shares` receipt
 * units of another token, none minted by a stake, or other than an unstake's planned units; a
 * stake that minted fewer than its least units passes and is booked as it landed (decision 0331);
 * `other_request` an unstake's request of another coin or amount, or ready before the plan's time
 * plus the unbonding time; `other_parts` a claim of other parts than its plan, or a move that names
 * a part of another action. Nothing a refused read-back says is booked.
 */
const landedMismatches = [
  "other_move",
  "other_coin",
  "other_shares",
  "other_request",
  "other_parts",
] as const;

/** A check of the venue host that a landed staking move's read-back failed. */
export type LandedMismatch = (typeof landedMismatches)[number];

function coinMismatch(landed: LandedStake, plan: StakePlan): boolean {
  const isOtherAsset = landed.moved.asset !== plan.moved.asset;
  return isOtherAsset || (plan.action === "stake" && landed.moved.base !== plan.value.base);
}

function sharesMismatch(landed: LandedStake, plan: StakePlan): boolean {
  const { shares } = landed;
  if (plan.action === "claim" || plan.shares === undefined) {
    return shares !== undefined;
  }
  if (shares === undefined || shares.asset !== plan.shares.asset) {
    return true;
  }
  return plan.action === "stake" ? shares.base < 1n : shares.base !== plan.shares.base;
}

function requestMismatch(landed: LandedStake, plan: StakePlan): boolean {
  const { request } = landed;
  if (plan.action !== "unstake") {
    return request !== undefined;
  }
  const earliestMs = plan.plannedAtMs + plan.unbondingSeconds * 1_000;
  return (
    request === undefined ||
    request.amount.asset !== plan.moved.asset ||
    request.amount.base !== landed.moved.base ||
    request.readyAtMs < earliestMs
  );
}

function partsMismatch(landed: LandedStake, plan: StakePlan): boolean {
  const { claimed } = landed;
  if (plan.action !== "claim") {
    return claimed !== undefined;
  }
  const planned = plan.parts ?? [];
  return (
    claimed === undefined ||
    claimed.length !== planned.length ||
    claimed.some((ref, index) => ref !== planned[index])
  );
}

/**
 * Holds what a venue read back of a landed staking move to the plan its card confirmed (decision
 * 0327): the same action and validator, the plan's coin and a stake's exact amount, the validator's
 * receipt units, an unstake's request no earlier than the unbonding time allows, and a claim's own
 * parts. Gives the first check that fails, or none.
 */
export function landedMismatch(
  landed: LandedStake,
  plan: StakePlan,
  family: ChainFamily,
): LandedMismatch | undefined {
  const isOtherMove =
    landed.action !== plan.action || !isSameAccount(landed.validator, plan.validator, family);
  const failed: readonly (readonly [LandedMismatch, boolean])[] = [
    ["other_move", isOtherMove],
    ["other_coin", coinMismatch(landed, plan)],
    ["other_shares", sharesMismatch(landed, plan)],
    ["other_request", requestMismatch(landed, plan)],
    ["other_parts", partsMismatch(landed, plan)],
  ];
  return failed.find(([, isFailed]) => isFailed)?.[0];
}
