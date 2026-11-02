import type { Id, Result } from "@binference/core";
import type {
  UnbondingClaim,
  UnbondingDraft,
  UnbondingQuery,
  UnbondingReadyQuery,
  UnbondingRecord,
  UnbondingTold,
  UnbondingWalletQuery,
} from "./unbonding-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps the coin unstakes took out until a claim takes it (database spec, `stake_unbondings`,
 * decision 0296): one row per unstake, opened when it reconciles or fills on paper, and marked by
 * the claim that takes it. Adapters: `stake_unbondings` in engine.sqlite, and a fake.
 */
export interface UnbondingStore {
  /**
   * Opens an unstake's unbonding and answers it; one of the intent already held is answered as it
   * is, and nothing changes, so a reconciliation run again opens it once. An intent the store does
   * not hold, or a request the venue's wallet holds under another unstake, throws
   * `store.constraint`.
   */
  open(draft: UnbondingDraft, options: StoreCall): Promise<UnbondingRecord>;
  /** The query's unbondings no claim took, the soonest ready first, then the oldest. */
  listOpen(query: UnbondingQuery, options: StoreCall): Promise<readonly UnbondingRecord[]>;
  /**
   * The wallet's unbondings in the mode no claim took, of every venue and validator, the soonest
   * ready first, then the oldest: the coin it waits for or may claim now.
   */
  openOf(query: UnbondingWalletQuery, options: StoreCall): Promise<readonly UnbondingRecord[]>;
  /** The unbondings a claim took, the soonest ready first, then the oldest. */
  claimedBy(claimIntentId: Id<"int">, options: StoreCall): Promise<readonly UnbondingRecord[]>;
  /**
   * Marks the query's unbondings of the requests named as taken by the claim at its time, and
   * answers every unbonding the claim holds; a request no row holds is left out, as one an unstake
   * outside binference made. A request another claim took is `taken`, and nothing changes.
   */
  claim(
    claim: UnbondingClaim,
    options: StoreCall,
  ): Promise<Result<readonly UnbondingRecord[], "taken">>;
  /**
   * The unbondings no claim took that are ready at the query's time and the owner was not told of
   * yet, in any wallet, mode, venue and validator, the soonest ready first, at most `limit`.
   */
  untoldReady(query: UnbondingReadyQuery, options: StoreCall): Promise<readonly UnbondingRecord[]>;
  /** Marks the unbondings as told ready at the time; one told already keeps its first time. */
  markTold(told: UnbondingTold, options: StoreCall): Promise<void>;
}
