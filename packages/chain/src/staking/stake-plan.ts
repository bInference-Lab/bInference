import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import { type AssetRef, assetRefParts, assetRefSchema } from "../caip/asset-ref.js";
import { type StakeAction, stakeActions } from "./staking-terms.js";

/** A validator's pool at one block: its receipt token units, and the coin they are worth. */
export interface StakePool {
  readonly shares: Amount;
  readonly coin: Amount;
}

/**
 * A receipt token a staking venue mints, as its pool stood at one block: the validator a stake
 * with it goes to, and the pool's units of the token with the coin they are worth together.
 */
export interface ReceiptPool {
  readonly validator: AccountRef;
  readonly pool: StakePool;
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
  /**
   * The validator's name as the venue listed it: outside content its operator chose, 1 to 64
   * characters with no control character.
   */
  readonly validatorName: string;
  /** What the validator keeps of its delegators' rewards, at the plan's block. */
  readonly commissionBps: Bps;
  /**
   * What a stake with the validator earned over its last recorded day of rewards, a year at that
   * rate, in basis points, read at the plan's block; absent when the venue cannot tell.
   */
  readonly aprBps?: number;
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
  /**
   * The least receipt units a stake mints when it lands, which its card promises: a venue whose
   * stake call takes no least amount sets it at its own bound under `shares`, and the host holds
   * the queue's new plan and the landed move to it. Absent when the venue promises none.
   */
  readonly minShares?: Amount;
  /** The validator's pool a stake or an unstake prices its shares by. */
  readonly pool?: StakePool;
  /**
   * The voting token the venue mints to the wallet with a stake's receipt units and burns with
   * them, such as StakeHub's govBNB: an unstake may take it out of the wallet beside them. Absent
   * when the venue has none.
   */
  readonly votingToken?: AssetRef;
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
  readonly aprBps?: number;
  readonly jailed: boolean;
  readonly paper: boolean;
  readonly value: AmountWire;
  readonly moved: AmountWire;
  readonly shares?: AmountWire;
  readonly minShares?: AmountWire;
  readonly pool?: StakePoolWire;
  readonly votingToken?: string;
  readonly parts?: readonly string[];
  readonly unbondingSeconds: number;
  readonly readyAtMs?: number;
  readonly plannedAtMs: number;
}

const epochMsSchema = z.int().nonnegative();

// A name its operator chose: shown on the card, cut there, and kept short in the terms hash.
const validatorNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+$/u);

// A yearly rate no venue pays: above 10,000% is not a reading of rewards.
const aprBpsSchema = z.int().min(0).max(1_000_000);
const poolSchema: z.ZodType<StakePool, StakePoolWire> = z.strictObject({
  shares: amountSchema,
  coin: amountSchema,
});

/** A {@link ReceiptPool} as JSON carries it. */
export interface ReceiptPoolWire {
  readonly validator: string;
  readonly pool: StakePoolWire;
}

/** Parses a receipt token's pool as a venue answers it. */
export const receiptPoolSchema: z.ZodType<ReceiptPool, ReceiptPoolWire> = z.strictObject({
  validator: accountRefSchema,
  pool: poolSchema,
});

function amountsOf(plan: StakePlan): readonly Amount[] {
  const { value, moved, shares, minShares, pool } = plan;
  return [value, moved, ...[shares, minShares].filter((item) => item !== undefined)].concat(
    pool === undefined ? [] : [pool.shares, pool.coin],
  );
}

// Every account and amount of a plan is of the wallet's chain; a stake and an unstake carry
// shares and a pool, a claim its parts; only a stake sends coin or promises least shares, of its
// own receipt token and no more than it plans, only an unstake has a ready time, and only an
// unstake or a claim plans from a jailed validator.
function isShaped(plan: StakePlan): boolean {
  return isOneChain(plan) && fitsAction(plan) && fitsLeast(plan);
}

function fitsLeast({ action, shares, minShares }: StakePlan): boolean {
  return (
    minShares === undefined ||
    (action === "stake" &&
      shares !== undefined &&
      minShares.asset === shares.asset &&
      minShares.base > 0n &&
      minShares.base <= shares.base)
  );
}

function isOneChain(plan: StakePlan): boolean {
  const chain = accountRefParts(plan.wallet).chain;
  const assets = [...amountsOf(plan).map(({ asset }) => asset), plan.votingToken ?? []].flat();
  return (
    accountRefParts(plan.validator).chain === chain &&
    amountsOf(plan).every(({ base }) => base >= 0n) &&
    assets.every((asset) => assetRefParts(asset).chain === chain)
  );
}

function fitsAction(plan: StakePlan): boolean {
  const isClaim = plan.action === "claim";
  return (
    (plan.action === "stake" || plan.value.base === 0n) &&
    (plan.shares !== undefined && plan.pool !== undefined) === !isClaim &&
    (plan.parts !== undefined) === isClaim &&
    (plan.readyAtMs !== undefined) === (plan.action === "unstake") &&
    (plan.action !== "stake" || !plan.jailed)
  );
}

/**
 * Decodes a stake plan from JSON, and encodes it back with `z.encode`: every account and amount on
 * the wallet's chain, coin sent only by a stake, shares and a pool on a stake or an unstake, least
 * shares only on a stake and within its shares, a ready time only on an unstake, the parts only on
 * a claim, and no stake from a jailed validator.
 */
export const stakePlanSchema: z.ZodType<StakePlan, StakePlanWire> = z
  .strictObject({
    action: z.enum(stakeActions),
    wallet: accountRefSchema,
    validator: accountRefSchema,
    validatorName: validatorNameSchema,
    commissionBps: bpsSchema,
    aprBps: aprBpsSchema.exactOptional(),
    jailed: z.boolean(),
    paper: z.boolean(),
    value: amountSchema,
    moved: amountSchema,
    shares: amountSchema.exactOptional(),
    minShares: amountSchema.exactOptional(),
    pool: poolSchema.exactOptional(),
    votingToken: assetRefSchema.exactOptional(),
    parts: z.array(z.string().min(1).max(200)).min(1).exactOptional(),
    unbondingSeconds: z.int().nonnegative(),
    readyAtMs: epochMsSchema.exactOptional(),
    plannedAtMs: epochMsSchema,
  })
  .refine(isShaped, { message: "A stake plan's parts must fit its action and its chain." });
