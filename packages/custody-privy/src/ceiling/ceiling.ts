import type { ChainRef } from "@binference/chain";
import type { EvmChain } from "@binference/chain-evm";
import type { PolicyRule } from "./policy-rule.js";

/** What the ceiling allows on one chain (spec 5, section 4). */
export interface CeilingChain {
  readonly chain: EvmChain;
  /** The registry's contracts for the agent's enabled venues on this chain: what a call may reach. */
  readonly contracts: readonly string[];
  /** The registry's spenders on this chain: the only accounts an `approve` may name. */
  readonly spenders: readonly string[];
  /**
   * The most native coin, in base units, that one contract call may send: 1 BNB by default
   * (decision 0094). Sends to the rescue address and saved addresses carry no cap.
   */
  readonly perTxNativeCapBase: bigint;
}

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

/** Why a ceiling cannot be built from a request. */
export type CeilingProblem =
  | "no_chain"
  | "repeated_chain"
  | "malformed_address"
  | "too_many_addresses"
  | "negative_cap";
