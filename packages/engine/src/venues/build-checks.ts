import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  type ChainFamily,
  type DecodedEffect,
  type DraftCall,
  type TokenApproval,
  type TxDraft,
} from "@binference/chain";
import { type Bps, bpsPerWhole, err, mulDiv, ok, type Result } from "@binference/core";

/**
 * Why the venue host refused what a venue quoted or built (ARCHITECTURE.md section 7, step 3).
 * The intent stores `decode_mismatch`; the mismatch names the check that failed.
 */
export const buildMismatches = [
  "quote_mismatch",
  "unreadable_step",
  "other_sender",
  "step_order",
  "undeclared_contract",
  "other_approval",
  "other_recipient",
  "other_amount",
  "low_min_out",
  "late_deadline",
] as const;

/** A check of the venue host that what a venue built failed. */
export type BuildMismatch = (typeof buildMismatches)[number];

/** A token approval step: the chain family read the approval from the draft's bytes. */
export interface ApprovalStep {
  readonly kind: "approval";
  /** The host's own copy of the draft the venue built. */
  readonly draft: TxDraft;
  readonly call: DraftCall;
  readonly approval: TokenApproval;
}

/** A trade call: the venue's decoder read its effect from the draft's bytes. */
export interface TradeStep {
  readonly kind: "trade";
  /** The host's own copy of the draft the venue built. */
  readonly draft: TxDraft;
  readonly call: DraftCall;
  readonly effect: DecodedEffect;
}

/** One step of a trade's plan, as the host read it. */
export type PlanStep = ApprovalStep | TradeStep;

/** The terms every step of a trade must keep. */
export interface TradeBounds {
  /** The agent's own wallet: it signs every step and receives the output. */
  readonly wallet: AccountRef;
  readonly amountIn: Amount;
  readonly assetOut: AssetRef;
  /** The native coin of the wallet's chain, the only input a trade call sends as value. */
  readonly nativeAsset: AssetRef;
  /** The venue's declared contracts on the wallet's chain, read from the registry. */
  readonly contracts: readonly AccountRef[];
  /** The policy's minimum output: the quote less the slippage the policy allowed. */
  readonly minOutBase: bigint;
  /** The latest deadline a trade call may carry, in epoch milliseconds. */
  readonly latestDeadlineMs: number;
  /** The family that writes the wallet's addresses, which compares accounts. */
  readonly family: ChainFamily;
}

/**
 * The policy's minimum output: the quoted output less the slippage the policy allowed, rounded
 * up, so the floor never moves in the venue's favor.
 */
export function minOutFloor(expectedOutBase: bigint, slippageBps: Bps): bigint {
  const kept = { numerator: BigInt(bpsPerWhole - slippageBps), denominator: BigInt(bpsPerWhole) };
  return mulDiv(expectedOutBase, kept, "up");
}

// Two accounts are one when they share a chain and their family reads one canonical address.
function isSameAccount(left: AccountRef, right: AccountRef, family: ChainFamily): boolean {
  const [one, two] = [accountRefParts(left), accountRefParts(right)];
  const [first, second] = [family.parseAddress(one.address), family.parseAddress(two.address)];
  return one.chain === two.chain && first.ok && second.ok && first.value === second.value;
}

function isDeclared(account: AccountRef, bounds: TradeBounds): boolean {
  return bounds.contracts.some((contract) => isSameAccount(contract, account, bounds.family));
}

function isFromWallet(draft: TxDraft, bounds: TradeBounds): boolean {
  const isOnChain = draft.chain === accountRefParts(bounds.wallet).chain;
  return isOnChain && isSameAccount(draft.from, bounds.wallet, bounds.family);
}

// Rule 8: an approval is exact, on the input token, to a contract the venue declared.
function approvalMismatch(step: ApprovalStep, bounds: TradeBounds): BuildMismatch | undefined {
  const { approval } = step;
  if (!isDeclared(approval.spender, bounds)) {
    return "undeclared_contract";
  }
  const isExact =
    approval.asset === bounds.amountIn.asset && approval.amountBase === bounds.amountIn.base;
  return isExact && step.call.nativeValue === 0n ? undefined : "other_approval";
}

// The call spends exactly the input; only the native coin travels as the call's value.
function spendsExactly({ call, effect }: TradeStep, bounds: TradeBounds): boolean {
  const { amountIn } = bounds;
  const value = amountIn.asset === bounds.nativeAsset ? amountIn.base : 0n;
  const isInput =
    effect.amountIn.asset === amountIn.asset && effect.amountIn.base === amountIn.base;
  return isInput && call.nativeValue === value;
}

function tradeMismatch(step: TradeStep, bounds: TradeBounds): BuildMismatch | undefined {
  const { call, effect } = step;
  if (!isDeclared(call.target, bounds)) {
    return "undeclared_contract";
  }
  if (!isSameAccount(effect.recipient, bounds.wallet, bounds.family)) {
    return "other_recipient";
  }
  if (!spendsExactly(step, bounds)) {
    return "other_amount";
  }
  if (effect.minOut.asset !== bounds.assetOut || effect.minOut.base < bounds.minOutBase) {
    return "low_min_out";
  }
  return effect.deadlineMs > bounds.latestDeadlineMs ? "late_deadline" : undefined;
}

interface OrderedPlan {
  readonly approval?: ApprovalStep;
  readonly trade: TradeStep;
}

// A plan is one trade call, or one token approval and then one trade call.
function orderOf(steps: readonly PlanStep[]): OrderedPlan | undefined {
  const [first, second, ...rest] = steps;
  if (rest.length > 0 || first === undefined) {
    return undefined;
  }
  if (second === undefined) {
    return first.kind === "trade" ? { trade: first } : undefined;
  }
  return first.kind === "approval" && second.kind === "trade"
    ? { approval: first, trade: second }
    : undefined;
}

/**
 * The build-step checks of the money path. Every step goes from the wallet on its chain; the plan
 * is at most one token approval, then exactly one trade call; the approval is exact on the input
 * token, to a contract the venue declared; and the trade call goes to a declared contract, pays
 * the wallet, spends exactly the input, accepts no less than the policy's minimum output and
 * expires by the latest deadline. Gives the trade call's effect, or the first check that fails.
 */
export function checkSteps(
  steps: readonly PlanStep[],
  bounds: TradeBounds,
): Result<DecodedEffect, BuildMismatch> {
  if (!steps.every((step) => isFromWallet(step.draft, bounds))) {
    return err("other_sender");
  }
  const plan = orderOf(steps);
  if (plan === undefined) {
    return err("step_order");
  }
  const { approval, trade } = plan;
  const mismatch =
    (approval === undefined ? undefined : approvalMismatch(approval, bounds)) ??
    tradeMismatch(trade, bounds);
  return mismatch === undefined ? ok(trade.effect) : err(mismatch);
}
