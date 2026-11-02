import { z } from "zod";
import { type AmountWire, amountSchema } from "../amount.js";
import { accountRefSchema } from "../caip/account-ref.js";
import { type LandedStake, stakeActions, type StakeAction } from "./staking-terms.js";

/** An unstake's request, as JSON carries it. */
export interface UnbondingPartWire {
  readonly ref: string;
  readonly amount: AmountWire;
  readonly readyAtMs: number;
}

/** A {@link LandedStake} as JSON carries it. */
export interface LandedStakeWire {
  readonly action: StakeAction;
  readonly validator: string;
  readonly moved: AmountWire;
  readonly shares?: AmountWire;
  readonly request?: UnbondingPartWire;
  readonly claimed?: readonly string[];
}

const refSchema = z.string().min(1).max(200);

/**
 * Decodes what a venue read back of a landed staking move, and encodes it back with `z.encode`:
 * accounts and amounts in their CAIP forms, amounts never negative, an unstake's request with its
 * ref and ready time, and a claim's refs, none empty. Whether it fits the move's plan is the host's
 * check, not this shape's.
 */
export const landedStakeSchema: z.ZodType<LandedStake, LandedStakeWire> = z.strictObject({
  action: z.enum(stakeActions),
  validator: accountRefSchema,
  moved: amountSchema,
  shares: amountSchema.exactOptional(),
  request: z
    .strictObject({ ref: refSchema, amount: amountSchema, readyAtMs: z.int().nonnegative() })
    .exactOptional(),
  claimed: z.array(refSchema).exactOptional(),
});
