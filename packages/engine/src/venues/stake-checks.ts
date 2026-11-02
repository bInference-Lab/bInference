import {
  type AccountRef,
  accountRefParts,
  type ChainFamily,
  isSameAccount,
  type TxDraft,
} from "@binference/chain";
import type { DecodedStake, StakePlan } from "@binference/chain/staking";
import type { BuildMismatch } from "./build-checks.js";

/** A staking call as the host read it: its draft, and what the venue's decoder read from it. */
export interface StakeStep {
  /** The host's own copy of the draft the venue built. */
  readonly draft: TxDraft;
  readonly decoded: DecodedStake;
}

/** What a staking plan's one call must keep beyond the plan itself. */
export interface StakeBounds {
  /** The venue's declared contracts on the plan's chain, read from the registry. */
  readonly contracts: readonly AccountRef[];
  /** The family that writes the wallet's addresses, which compares accounts. */
  readonly family: ChainFamily;
}

// The decoded move is the plan's: its action and validator, exactly its coin, an unstake's share
// count and a claim's count of parts, and nothing else.
function isPlannedMove(decoded: DecodedStake, plan: StakePlan, family: ChainFamily): boolean {
  return (
    decoded.action === plan.action &&
    isSameAccount(decoded.validator, plan.validator, family) &&
    decoded.value === plan.value.base &&
    decoded.shares === (plan.action === "unstake" ? plan.shares?.base : undefined) &&
    decoded.parts === (plan.action === "claim" ? plan.parts?.length : undefined)
  );
}

/**
 * The build-step checks of a staking move (decision 0327): its plan is exactly one call, from the
 * plan's wallet on the wallet's chain, to a contract the venue declared, crediting that wallet
 * alone, and making the plan's move: its action, validator, coin, an unstake's shares and a
 * claim's count of parts. Gives the first check that fails, or none.
 */
export function stakeMismatch(
  steps: readonly StakeStep[],
  plan: StakePlan,
  bounds: StakeBounds,
): BuildMismatch | undefined {
  const { family, contracts } = bounds;
  const [step, ...rest] = steps;
  if (step === undefined || rest.length > 0) {
    return "step_order";
  }
  const { draft, decoded } = step;
  const isOnChain = draft.chain === accountRefParts(plan.wallet).chain;
  if (!isOnChain || !isSameAccount(draft.from, plan.wallet, family)) {
    return "other_sender";
  }
  if (!contracts.some((contract) => isSameAccount(contract, decoded.contract, family))) {
    return "undeclared_contract";
  }
  if (!isSameAccount(decoded.credits, plan.wallet, family)) {
    return "other_recipient";
  }
  return isPlannedMove(decoded, plan, family) ? undefined : "other_stake";
}
