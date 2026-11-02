import { type AssetRef, type ChainFamily, isSameAccount } from "@binference/chain";
import type { StakePlan, StakeRequest, UnbondingPart } from "@binference/chain/staking";
import type { BuildMismatch } from "./build-checks.js";

// The plan is of the move asked: its action from its wallet with its validator, in its mode; a
// stake sends exactly its amount, nothing else sends coin, and what it moves is that coin.
function isAskedMove(plan: StakePlan, request: StakeRequest, family: ChainFamily): boolean {
  const isSame =
    plan.action === request.action &&
    isSameAccount(plan.wallet, request.wallet, family) &&
    isSameAccount(plan.validator, request.validator, family) &&
    plan.paper === (request.paper !== undefined) &&
    plan.moved.asset === plan.value.asset;
  return request.action === "stake"
    ? isSame && plan.value.asset === request.amount.asset && plan.value.base === request.amount.base
    : isSame && plan.value.base === 0n;
}

/**
 * Holds a staking venue's plan to the request (decision 0327): `other_plan` for a plan of another
 * action, wallet, validator, mode or coin, and `short_unstake` for an unstake of an amount that
 * takes out less than that amount. Gives the first check that fails, or none.
 */
export function planMismatch(
  plan: StakePlan,
  request: StakeRequest,
  family: ChainFamily,
): BuildMismatch | undefined {
  if (!isAskedMove(plan, request, family)) {
    return "other_plan";
  }
  const isShort =
    request.action === "unstake" &&
    request.amount !== "whole" &&
    plan.moved.base < request.amount.base;
  return isShort ? "short_unstake" : undefined;
}

/**
 * Holds a claim's plan to the wallet's own unbonding parts (decision 0327): every part it takes is
 * one the wallet holds with the validator, ready at the plan's time, and it takes at least one;
 * else `unready_part`. Any other plan passes.
 */
export function claimMismatch(
  plan: StakePlan,
  held: readonly UnbondingPart[],
): BuildMismatch | undefined {
  if (plan.action !== "claim") {
    return undefined;
  }
  const ready = new Set(
    held.filter((part) => part.readyAtMs <= plan.plannedAtMs).map((part) => part.ref),
  );
  const parts = plan.parts ?? [];
  return parts.length > 0 && parts.every((ref) => ready.has(ref)) ? undefined : "unready_part";
}

/**
 * Holds a stake's or an unstake's shares to the validator's receipt token, which the venue names
 * apart (decision 0327): `other_receipt` when they differ. A claim moves no shares and passes.
 */
export function receiptMismatch(plan: StakePlan, receipt: AssetRef): BuildMismatch | undefined {
  return plan.shares === undefined || plan.shares.asset === receipt ? undefined : "other_receipt";
}
