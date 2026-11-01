import type { Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { TxDraft } from "../transaction.js";
import type { VenueDeclaration } from "../venues/venue.js";
import type { StakePlan } from "./stake-plan.js";
import type {
  DecodedStake,
  LandedRequest,
  LandedStake,
  StakeRefusal,
  StakeRequest,
  StakingHolding,
  StakingOptions,
} from "./staking-terms.js";

/**
 * A staking venue on one chain: it lists its validators, reads what a wallet holds with them,
 * plans a stake, an unstake or a claim at the latest block, builds the planned call, decodes a
 * call back from its bytes, and reads back what a landed move did. Every move it builds credits
 * the wallet that signs it, and its decoder reads no call that could credit anyone else. It never
 * signs, sends or decides. It declares its contracts and calls like any venue, so a ceiling holds
 * their rules. Adapters: staking plugins, such as StakeHub's.
 */
export interface StakingVenue extends VenueDeclaration {
  /** The chain it stakes the coin of. */
  readonly chain: ChainRef;
  /**
   * Its validators, unbonding time and least stake, read at the latest block. A venue that cannot
   * read its contracts throws. Rejects with the signal's reason once the signal aborts.
   */
  options(options: { readonly signal: AbortSignal }): Promise<StakingOptions>;
  /**
   * What the wallet holds with each validator at the latest block: stake, or parts unstakes took
   * out; a validator it holds none of is left out. A venue that cannot read its contracts throws.
   * Rejects with the signal's reason once the signal aborts.
   */
  holdings(
    wallet: AccountRef,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly StakingHolding[]>;
  /**
   * Plans the move at the latest block, or names why the venue would refuse it, in the order the
   * venue itself checks ({@link StakeRefusal}). With the request's paper position it reads only the
   * venue's state, never the wallet's. An amount outside the chain's coin, or a wallet or validator
   * of another chain, is a fault; so is a venue that cannot read its contracts. Rejects with the
   * signal's reason once the signal aborts.
   */
  plan(
    request: StakeRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<StakePlan, StakeRefusal>>;
  /**
   * Builds the planned move as one call from the plan's wallet, which credits that wallet alone.
   * A plan of another chain is a fault. Rejects with the signal's reason once the signal aborts.
   */
  build(plan: StakePlan, options: { readonly signal: AbortSignal }): Promise<readonly TxDraft[]>;
  /**
   * Decodes a call the venue builds, from the draft's bytes alone. A call to another contract, of
   * another function, in another form than the venue builds, or one that could credit anyone but
   * the draft's sender, is `unknown_call`, never a guess.
   */
  decode(draft: TxDraft): Result<DecodedStake, "unknown_call">;
  /**
   * What the transaction's move of the wallet with the validator did, read from its own events
   * and the venue's state at its block: a transaction that holds no such move, such as a revert,
   * is `not_found`. A venue that cannot read the transaction or that state throws. Rejects with
   * the signal's reason once the signal aborts.
   */
  landed(
    move: LandedRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LandedStake, "not_found">>;
}
