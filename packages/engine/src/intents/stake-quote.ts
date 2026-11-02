import { type StakePlan, type StakePlanWire, stakePlanSchema } from "@binference/chain/staking";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/**
 * What a stake, an unstake or a claim's card confirms (decision 0296): the staking venue and the
 * move it planned at one block, which names the validator, its commission and yearly rate, and the
 * coin the move puts in, takes out or claims back. A stake keeps it in the intent's `quote`
 * column, so the card's terms hash binds the plan, and the wallet queue plans again against it.
 */
export interface StakeIntentQuote {
  readonly venue: string;
  readonly plan: StakePlan;
}

/** A {@link StakeIntentQuote} as JSON carries it. */
interface StakeIntentQuoteWire {
  readonly venue: string;
  readonly plan: StakePlanWire;
}

const stakeIntentQuoteSchema: z.ZodType<StakeIntentQuote, StakeIntentQuoteWire> = z.strictObject({
  venue: z.string().min(1).max(200),
  plan: stakePlanSchema,
});

/** A staking move's quote, in the `quote` column of a `stake` intent. */
export const stakeQuoteDocument: DocumentCodec<StakeIntentQuote> = documentCodec(
  "stake quote",
  stakeIntentQuoteSchema,
);
