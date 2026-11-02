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
  /**
   * Planned on a liquid venue's pool (decision 0331): the card names the venue, not a validator,
   * and an unstake's amount in its receipt units.
   */
  readonly liquid?: true;
}

/** A {@link StakeIntentQuote} as JSON carries it. */
interface StakeIntentQuoteWire {
  readonly venue: string;
  readonly plan: StakePlanWire;
  readonly liquid?: true;
}

const stakeIntentQuoteSchema: z.ZodType<StakeIntentQuote, StakeIntentQuoteWire> = z.strictObject({
  venue: z.string().min(1).max(200),
  plan: stakePlanSchema,
  liquid: z.literal(true).exactOptional(),
});

/** A staking move's quote, in the `quote` column of a `stake` intent. */
export const stakeQuoteDocument: DocumentCodec<StakeIntentQuote> = documentCodec(
  "stake quote",
  stakeIntentQuoteSchema,
);
