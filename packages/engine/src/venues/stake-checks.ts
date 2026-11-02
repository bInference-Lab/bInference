import {
  type AccountRef,
  accountRefParts,
  type ChainFamily,
  isSameAccount,
  type TxDraft,
} from "@binference/chain";
import type { DecodedStake, StakePlan } from "@binference/chain/staking";
import type { ApprovalStep, BuildMismatch } from "./build-checks.js";

/** A staking call as the host read it: its draft, and what the venue's decoder read from it. */
export interface StakeStep {
  readonly kind: "stake";
  /** The host's own copy of the draft the venue built. */
  readonly draft: TxDraft;
  readonly decoded: DecodedStake;
}

/** One step of a staking move's build: its staking call, or the approval a liquid unstake makes. */
export type StakePlanStep = ApprovalStep | StakeStep;

/** What a staking plan's calls must keep beyond the plan itself. */
export interface StakeBounds {
  /** The venue's declared contracts on the plan's chain, read from the registry. */
  readonly contracts: readonly AccountRef[];
  /** The spenders the venue declares on the plan's chain, any wallet's to approve. */
  readonly spenders: readonly AccountRef[];
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
    decoded.parts === (plan.action === "claim" ? plan.parts?.length : undefined) &&
    namesItsParts(decoded, plan)
  );
}

// A live claim whose call names its parts names exactly the plan's; a paper claim's call, never
// sent, names no part of the chain (decision 0331).
function namesItsParts(decoded: DecodedStake, plan: StakePlan): boolean {
  const { refs } = decoded;
  if (refs === undefined || plan.paper) {
    return true;
  }
  const parts = plan.parts ?? [];
  return refs.length === parts.length && refs.every((ref, index) => ref === parts[index]);
}

interface OrderedStake {
  readonly approval?: ApprovalStep;
  readonly stake: StakeStep;
}

// A plan is one staking call, or for an unstake one token approval and then its staking call.
function orderOf(steps: readonly StakePlanStep[], plan: StakePlan): OrderedStake | undefined {
  const [first, second, ...rest] = steps;
  if (first === undefined || rest.length > 0) {
    return undefined;
  }
  if (second === undefined) {
    return first.kind === "stake" ? { stake: first } : undefined;
  }
  const isApproved = plan.action === "unstake" && first.kind === "approval";
  return isApproved && second.kind === "stake" ? { approval: first, stake: second } : undefined;
}

// An unstake's approval is exactly its receipt units, sends no coin, and names a declared spender.
function approvalMismatch(
  step: ApprovalStep,
  plan: StakePlan,
  bounds: StakeBounds,
): BuildMismatch | undefined {
  const { approval, call } = step;
  if (!bounds.spenders.some((item) => isSameAccount(item, approval.spender, bounds.family))) {
    return "undeclared_contract";
  }
  const { shares } = plan;
  const isExact =
    shares !== undefined &&
    approval.asset === shares.asset &&
    approval.amountBase === shares.base &&
    call.nativeValue === 0n;
  return isExact ? undefined : "other_approval";
}

function callMismatch(
  step: StakeStep,
  plan: StakePlan,
  bounds: StakeBounds,
): BuildMismatch | undefined {
  const { family, contracts } = bounds;
  const { decoded } = step;
  if (!contracts.some((contract) => isSameAccount(contract, decoded.contract, family))) {
    return "undeclared_contract";
  }
  if (!isSameAccount(decoded.credits, plan.wallet, family)) {
    return "other_recipient";
  }
  return isPlannedMove(decoded, plan, family) ? undefined : "other_stake";
}

/**
 * The build-step checks of a staking move (decisions 0327 and 0331): every call goes from the
 * plan's wallet on the wallet's chain; the plan is one staking call, or for an unstake one
 * approval of exactly its receipt units, sending no coin, to a spender the venue declared, and
 * then that call; the call goes to a contract the venue declared, credits that wallet alone and
 * makes the plan's move: its action, validator, coin, an unstake's shares and a claim's count of
 * parts, and a live claim's own parts where its call names them. Gives the first check that fails, or none.
 */
export function stakeMismatch(
  steps: readonly StakePlanStep[],
  plan: StakePlan,
  bounds: StakeBounds,
): BuildMismatch | undefined {
  const chain = accountRefParts(plan.wallet).chain;
  const isFromWallet = ({ draft }: StakePlanStep) =>
    draft.chain === chain && isSameAccount(draft.from, plan.wallet, bounds.family);
  if (!steps.every(isFromWallet)) {
    return "other_sender";
  }
  const ordered = orderOf(steps, plan);
  if (ordered === undefined) {
    return "step_order";
  }
  const { approval, stake } = ordered;
  return (
    (approval === undefined ? undefined : approvalMismatch(approval, plan, bounds)) ??
    callMismatch(stake, plan, bounds)
  );
}
