import type { Bps } from "@binference/core";
import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { TxHash } from "../transaction.js";

/** The three moves of staking: put the coin with a validator, take it out, claim it back. */
export const stakeActions = ["stake", "unstake", "claim"] as const;

/** One move of staking. */
export type StakeAction = (typeof stakeActions)[number];

/** A validator a staking venue lists, as its contracts tell it at one block. */
export interface StakingValidator {
  /** The validator's operator account, which every move names. */
  readonly validator: AccountRef;
  /** The name its operator set: outside content, which surfaces escape and cut. */
  readonly name: string;
  /** What the validator keeps of its delegators' rewards. */
  readonly commissionBps: Bps;
  /** What a stake earned over its last day of rewards, a year at that rate; absent when unknown. */
  readonly aprBps?: number;
  /** A jailed validator earns nothing and takes no stake from anyone but its operator. */
  readonly jailed: boolean;
  /** Until when a jailed validator stays jailed, epoch milliseconds. */
  readonly jailedUntilMs?: number;
}

/** What a staking venue offers on its chain now. */
export interface StakingOptions {
  readonly validators: readonly StakingValidator[];
  /** How long an unstake's coin waits before a claim can take it, read from the chain. */
  readonly unbondingSeconds: number;
  /** The least one stake may put in, in the chain's coin. */
  readonly minStake: Amount;
  /** The time of the block the options were read at, epoch milliseconds. */
  readonly readAtMs: number;
}

/** Coin an unstake took out, and when a claim can take it. */
export interface UnbondingPart {
  /**
   * The venue's own id of the unstake's request, unique for the venue and the wallet, such as a
   * credit contract and its sequence number; the reference a stored unbonding keeps.
   */
  readonly ref: string;
  /** In the chain's coin. */
  readonly amount: Amount;
  /**
   * When a claim can take it. A venue whose own queue releases a part (a liquid venue) gives the
   * earliest time while the part waits, never before its read, and no later than its read once
   * the queue released it.
   */
  readonly readyAtMs: number;
  /** The venue's queue has not released it yet, whatever its time: no claim can take it now. */
  readonly queued?: true;
}

/** What one wallet holds with one validator of a staking venue. */
export interface StakingHolding {
  readonly wallet: AccountRef;
  readonly validator: AccountRef;
  /** The venue's own receipt token, such as a validator's credit shares. */
  readonly staked: Amount;
  /** What the staked receipt token is worth in the chain's coin now. */
  readonly stakedValue: Amount;
  /** Every part unstakes took out that no claim took yet, oldest first, ready or not. */
  readonly unbonding: readonly UnbondingPart[];
  /** The coin a claim would take back now: the ready parts at the front of `unbonding`. */
  readonly claimable: Amount;
  /**
   * More parts wait than the venue reads at once, so `unbonding` holds the oldest of them and
   * `claimable` what those pay.
   */
  readonly unbondingCut?: true;
}

/**
 * A paper staking position with one validator, as the engine keeps it: the receipt token units
 * and the parts paper unstakes took out, oldest first. A plan given one reads no state of the
 * wallet itself, only the venue's.
 */
export interface PaperStake {
  readonly shares: bigint;
  readonly parts: readonly UnbondingPart[];
}

/**
 * What the host asks a staking venue to plan, for the agent's own wallet: a stake of exactly
 * `amount` of the chain's coin with a validator; an unstake of at least `amount` of the coin from
 * one, or of the whole stake, every receipt unit, with `whole`; or a claim of everything a
 * validator lets the wallet claim now. On a liquid venue the validator is its pool, an unstake's
 * `amount` is exactly that many units of its receipt token, and a claim takes the oldest part
 * its queue released. `paper` plans it against a paper position.
 */
export type StakeRequest = {
  readonly wallet: AccountRef;
  readonly validator: AccountRef;
  readonly paper?: PaperStake;
} & (
  | { readonly action: "stake"; readonly amount: Amount }
  | { readonly action: "unstake"; readonly amount: Amount | "whole" }
  | { readonly action: "claim" }
);

/**
 * Why a staking venue plans no move, each an answer that names the owner's next step (spec 6):
 * `validator_unknown`, the venue lists no such validator; `validator_jailed`, a stake names a
 * jailed validator (an unstake or a claim from one passes); `below_min_stake`, a stake under the
 * venue's least; `nothing_staked`, an unstake from a validator the wallet holds nothing with;
 * `exceeds_staked`, an unstake of more than the stake is worth; `nothing_to_claim`, a claim with
 * nothing ready; `staking_paused`, the venue takes no move now; `wallet_blocked`, the venue refuses
 * this wallet; `claim_unpayable`, the venue pays a claim in a way the wallet's code cannot take.
 */
export const stakeRefusals = [
  "validator_unknown",
  "validator_jailed",
  "below_min_stake",
  "nothing_staked",
  "exceeds_staked",
  "nothing_to_claim",
  "staking_paused",
  "wallet_blocked",
  "claim_unpayable",
] as const;

/** Why a staking venue plans no move. */
export type StakeRefusal = (typeof stakeRefusals)[number];

/**
 * What a refusal names besides its reason, which the owner's words show: the venue's least stake
 * with `below_min_stake`, and with `nothing_to_claim` when the wallet's next part is ready, absent
 * when no part waits.
 */
export interface StakeRefusalFacts {
  readonly minStake?: Amount;
  readonly readyAtMs?: number;
}

/**
 * What a staking call does, read from a draft's bytes alone. Every move credits `credits`: the
 * venue decodes only calls whose coin and receipt token go to the account that signs.
 */
export interface DecodedStake {
  readonly action: StakeAction;
  /** The contract the call goes to. */
  readonly contract: AccountRef;
  readonly validator: AccountRef;
  /** The account the move credits: the draft's sender. */
  readonly credits: AccountRef;
  /** The coin the call sends, in base units. */
  readonly value: bigint;
  /** An unstake's receipt token units. */
  readonly shares?: bigint;
  /** How many unbonding parts a claim takes. */
  readonly parts?: number;
  /**
   * The refs of the parts a claim's call names, when its call names them, as a liquid venue's
   * claim of one request by its id does; absent when the call names only a count.
   */
  readonly refs?: readonly string[];
}

/** A transaction that landed a staking move of the wallet with the validator. */
export interface LandedRequest {
  readonly action: StakeAction;
  readonly wallet: AccountRef;
  readonly validator: AccountRef;
  readonly hash: TxHash;
}

/**
 * What a landed staking move did, read from its transaction and the venue's state at its block:
 * the coin a stake put in, an unstake took out or a claim paid, the receipt units a stake minted or
 * an unstake burned, an unstake's request with the time the venue set from the landing block, and
 * the parts a claim took.
 */
export interface LandedStake {
  readonly action: StakeAction;
  readonly validator: AccountRef;
  readonly moved: Amount;
  readonly shares?: Amount;
  readonly request?: UnbondingPart;
  readonly claimed?: readonly string[];
}
