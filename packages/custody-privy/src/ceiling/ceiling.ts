import type { ChainRef } from "@binference/chain";
import type { EvmChain } from "@binference/chain-evm";
import type { AbiFunction, PolicyRule } from "./policy-rule.js";

/** One function a wallet may call on one contract (decision 0149). */
export interface CeilingCall {
  /** The contract, an EVM address in any case. */
  readonly contract: string;
  /** The function, as the JSON ABI entry Privy decodes the calldata with. */
  readonly abi: AbiFunction;
  /** The function's address inputs that must be the signing wallet itself, such as a receiver. */
  readonly walletInputs: readonly string[];
}

/** One rolling 24-hour cap: the Privy aggregation that sums it, and the most the sum may reach. */
export interface DayCap {
  /** The aggregation's id on Privy. */
  readonly aggregation: string;
  /** The most the sum may reach, in base units, the request being signed included. */
  readonly limitBase: bigint;
}

/** The most aggregations Privy keeps for one app ("Stateful policies", docs.privy.io). */
export const maxAggregations = 10;

/** The rolling 24-hour caps of one chain, each summed by Privy for every wallet of the app. */
export interface ChainCaps {
  /** The native coin the wallets send: a contract call stops once it would pass this. */
  readonly native: DayCap;
  /** One per capped token, on the amounts its `approve` calls name: approvals stop past it. */
  readonly approvals: readonly DayCap[];
}

/** What the ceiling allows on one chain (spec 5, section 4). */
export interface CeilingChain {
  readonly chain: EvmChain;
  /** The functions the agent's enabled venues call on this chain: the only calls allowed. */
  readonly calls: readonly CeilingCall[];
  /** The venues' declared spenders on this chain: the only accounts an `approve` may name. */
  readonly spenders: readonly string[];
  /**
   * The most native coin, in base units, that one contract call may send: 1 BNB by default
   * (decision 0094). Sends to the rescue address and saved addresses carry no cap.
   */
  readonly perTxNativeCapBase: bigint;
  readonly caps: ChainCaps;
}

/** A chain's ceiling before its 24-hour caps are attached, as the registry gives it. */
export type CeilingChainPlan = Omit<CeilingChain, "caps">;

/** Everything a wallet's ceiling is built from. Addresses are EVM addresses in any case. */
export interface CeilingRequest {
  /** The chains the owner enabled, chain 56 first. */
  readonly chains: readonly CeilingChain[];
  /** The owner's rescue address, which every send may pay. */
  readonly rescue: string;
  /** The addresses the owner saved with the owner key (decision 0091). */
  readonly saved: readonly string[];
}

/**
 * A wallet's ceiling: the Privy policy behind the engine's limits. Privy refuses every signature
 * its rules do not allow, whatever the machine asks.
 */
export interface Ceiling {
  /** The chains the ceiling enables, in the order asked. */
  readonly chains: readonly ChainRef[];
  readonly rules: readonly PolicyRule[];
}

/**
 * Why a ceiling cannot be built from a request: no or a repeated chain; a malformed address or
 * more than Privy lists; a negative cap; a call whose function name is too long for a rule name
 * or whose wallet input is no address input; two calls of one name that differ; a cap whose
 * aggregation is no Privy id; more aggregations than Privy keeps for an app.
 */
export type CeilingProblem =
  | "no_chain"
  | "repeated_chain"
  | "malformed_address"
  | "too_many_addresses"
  | "negative_cap"
  | "bad_call"
  | "clashing_calls"
  | "bad_cap"
  | "too_many_caps";
