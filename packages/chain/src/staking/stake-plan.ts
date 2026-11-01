import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";
import { type StakeAction, stakeActions } from "./staking-terms.js";

/** A validator's pool at one block: its receipt token units, and the coin they are worth. */
export interface StakePool {
  readonly shares: Amount;
  readonly coin: Amount;
}

/**
 * A move a staking venue planned at one block, which the host shows on the card, books on paper
 * and gives back to the venue's build. Every amount is the chain's coin but `shares` and the
 * pool's `shares`, the venue's receipt token.
 */
export interface StakePlan {
  readonly action: StakeAction;
  /** The agent's own wallet: it signs, and the move credits it alone. */
  readonly wallet: AccountRef;
  readonly validator: AccountRef;
  /** The validator's name as the venue listed it: outside content. */
  readonly validatorName: string;
  /** What the validator keeps of its delegators' rewards, at the plan's block. */
  readonly commissionBps: Bps;
  /** Whether the validator was jailed at the plan's block: only an unstake or a claim plans so. */
  readonly jailed: boolean;
  /** Whether it was planned against a paper position, reading none of the wallet's own state. */
  readonly paper: boolean;
  /** The coin the call sends: a stake's amount, nothing for an unstake or a claim. */
  readonly value: Amount;
  /** The coin the move puts in, takes out to unbond, or claims back, as read at the block. */
  readonly moved: Amount;
  /** The receipt token units a stake mints, or an unstake burns, at the plan's block. */
  readonly shares?: Amount;
  /** The validator's pool a stake or an unstake prices its shares by. */
  readonly pool?: StakePool;
  /** The refs of the unbonding parts a claim takes, oldest first. */
  readonly parts?: readonly string[];
  readonly unbondingSeconds: number;
  /**
   * The earliest an unstake's coin can be claimed, epoch milliseconds: the plan's block time plus
   * the unbonding time. The venue counts from the block the unstake lands in, so the read-back of
   * the landed move gives the time that holds.
   */
  readonly readyAtMs?: number;
  /** The time of the block the plan was read at, epoch milliseconds. */
  readonly plannedAtMs: number;
}

/** A {@link StakePool} as JSON carries it. */
export interface StakePoolWire {
  readonly shares: AmountWire;
  readonly coin: AmountWire;
}

/** A {@link StakePlan} as JSON carries it. */
export interface StakePlanWire {
  readonly action: StakeAction;
  readonly wallet: string;
  readonly validator: string;
  readonly validatorName: string;
  readonly commissionBps: number;
  readonly jailed: boolean;
  readonly paper: boolean;
  readonly value: AmountWire;
  readonly moved: AmountWire;
  readonly shares?: AmountWire;
  readonly pool?: StakePoolWire;
  readonly parts?: readonly string[];
  readonly unbondingSeconds: number;
  readonly readyAtMs?: number;
  readonly plannedAtMs: number;
}

const epochMsSchema = z.int().nonnegative();
const poolSchema: z.ZodType<StakePool, StakePoolWire> = z.strictObject({
  shares: amountSchema,
  coin: amountSchema,
});

function amountsOf(plan: StakePlan): readonly Amount[] {
  const { value, moved, shares, pool } = plan;
  return [value, moved, ...(shares === undefined ? [] : [shares])].concat(
    pool === undefined ? [] : [pool.shares, pool.coin],
  );
}

// Every account and amount of a plan is of the wallet's chain; a stake and an unstake carry
// shares and a pool, a claim its parts; only a stake sends coin, only an unstake has a ready time,
// and only an unstake or a claim plans from a jailed validator.
function isShaped(plan: StakePlan): boolean {
  const chain = accountRefParts(plan.wallet).chain;
  const isClaim = plan.action === "claim";
  return (
    accountRefParts(plan.validator).chain === chain &&
    amountsOf(plan).every(
      (amount) => assetRefParts(amount.asset).chain === chain && amount.base >= 0n,
    ) &&
    (plan.action === "stake" || plan.value.base === 0n) &&
    (plan.shares !== undefined && plan.pool !== undefined) === !isClaim &&
    (plan.parts !== undefined) === isClaim &&
    (plan.readyAtMs !== undefined) === (plan.action === "unstake") &&
    (plan.action !== "stake" || !plan.jailed)
  );
}

/**
 * Decodes a stake plan from JSON, and encodes it back with `z.encode`: every account and amount on
 * the wallet's chain, coin sent only by a stake, shares and a pool on a stake or an unstake, a
 * ready time only on an unstake, the parts only on a claim, and no stake from a jailed validator.
 */
export const stakePlanSchema: z.ZodType<StakePlan, StakePlanWire> = z
  .strictObject({
    action: z.enum(stakeActions),
    wallet: accountRefSchema,
    validator: accountRefSchema,
    validatorName: z.string(),
    commissionBps: bpsSchema,
    jailed: z.boolean(),
    paper: z.boolean(),
    value: amountSchema,
    moved: amountSchema,
    shares: amountSchema.exactOptional(),
    pool: poolSchema.exactOptional(),
    parts: z.array(z.string().min(1).max(200)).min(1).exactOptional(),
    unbondingSeconds: z.int().nonnegative(),
    readyAtMs: epochMsSchema.exactOptional(),
    plannedAtMs: epochMsSchema,
  })
  .refine(isShaped, { message: "A stake plan's parts must fit its action and its chain." });
