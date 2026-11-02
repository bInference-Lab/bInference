import type { Err, Ok, Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { AssetRef } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { TxDraft } from "../transaction.js";
import type { VenueDeclaration } from "../venues/venue.js";
import type { ReceiptPool, StakePlan } from "./stake-plan.js";
import type {
  DecodedStake,
  LandedRequest,
  LandedStake,
  StakeRefusal,
  StakeRefusalFacts,
  StakeRequest,
  StakingHolding,
  StakingOptions,
} from "./staking-terms.js";

/** A staking venue's plan, or its refusal with the facts that refusal's words name. */
export type StakePlanned =
  | Ok<StakePlan>
  | (Err<StakeRefusal> & { readonly facts?: StakeRefusalFacts });

/**
 * A staking venue on one chain: it lists its validators, reads what a wallet holds with them,
 * plans a stake, an unstake or a claim at the latest block, builds the planned call, decodes a
 * call back from its bytes, and reads back what a landed move did. Every move it builds credits
 * the wallet that signs it, and its decoder reads no call that could credit anyone else. It never
 * signs, sends or decides. It declares its contracts and calls like any venue, so a ceiling holds
 * their rules. Adapters: staking plugins, such as StakeHub's and Lista's.
 *
 * A liquid staking venue stakes into one {@link StakingVenue.pool} and lists no validators: every
 * move names the pool where a validator stands, its receipt token is a plain token the wallet
 * holds, an unstake names its amount in that token, and the venue's own queue says when an
 * unstake's coin can be claimed.
 */
export interface StakingVenue extends VenueDeclaration {
  /** The chain it stakes the coin of. */
  readonly chain: ChainRef;
  /**
   * The one pool a liquid staking venue stakes into, such as Lista's stake manager: `options`
   * lists it alone, every request and plan names it as its validator, and a request that names
   * another is `validator_unknown`. Absent on a venue of validators.
   */
  readonly pool?: AccountRef;
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
   * The receipt token a stake with the validator mints, such as its credit shares, in which a
   * paper position of that stake is kept; `validator_unknown` for a validator the venue does not
   * list. A venue that cannot read its contracts throws. Rejects with the signal's reason once the
   * signal aborts.
   */
  receipt(
    validator: AccountRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<AssetRef, "validator_unknown">>;
  /**
   * The pools of the receipt tokens named that the venue mints, at the latest block, one each, in
   * the order named, each with the validator it stakes with; a token it does not mint, or whose
   * pool holds no units, is left out. What some units are worth in the chain's coin is their part
   * of the pool's coin. A venue that cannot read its contracts throws. Rejects with the signal's
   * reason once the signal aborts.
   */
  pools(
    receipts: readonly AssetRef[],
    options: { readonly signal: AbortSignal },
  ): Promise<readonly ReceiptPool[]>;
  /**
   * Plans the move at the latest block, or names why the venue would refuse it, in the order the
   * venue itself checks ({@link StakeRefusal}), with the facts its words name
   * ({@link StakeRefusalFacts}). With the request's paper position it reads only the
   * venue's state, never the wallet's. An amount outside the chain's coin, or a wallet or validator
   * of another chain, is a fault; so is a venue that cannot read its contracts. Rejects with the
   * signal's reason once the signal aborts.
   */
  plan(request: StakeRequest, options: { readonly signal: AbortSignal }): Promise<StakePlanned>;
  /**
   * Builds the planned move from the plan's wallet, crediting that wallet alone: one call, after
   * a token approval of exactly the plan's receipt units to a spender the venue declares when an
   * unstake's call pulls them from the wallet, as a liquid venue's does. A plan of another chain
   * is a fault. Rejects with the signal's reason once the signal aborts.
   */
  build(plan: StakePlan, options: { readonly signal: AbortSignal }): Promise<readonly TxDraft[]>;
  /**
   * Decodes a staking call the venue builds, from the draft's bytes alone; a token approval is no
   * staking call, and the chain's family reads it. A call to another contract, of another
   * function, in another form than the venue builds, or one that could credit anyone but the
   * draft's sender, is `unknown_call`, never a guess.
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
