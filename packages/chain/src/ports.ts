import type { Result } from "@binference/core";
import type { ChainRef } from "./caip/chain-ref.js";
import type { DraftCall } from "./draft-call.js";
import type { RegisteredChain } from "./registry/registered-chain.js";
import type { SignatureProblem, SignedTx, TxDraft, TxHash, UnsignedTx } from "./transaction.js";

/**
 * What a chain family does for the chain-neutral core. A family package (EVM now, Solana later)
 * implements it; the core never names a family.
 */
export interface ChainFamily {
  /** The family's registry id, which chain definitions name. */
  readonly id: string;
  /** The CAIP-2 namespace of the family's chains. */
  readonly namespace: string;
  /**
   * Parses an address as a person or a venue wrote it into the family's canonical form, which
   * compares equal for one account. Malformed text is an expected failure, never a throw.
   */
  parseAddress(text: string): Result<string, "malformed_address">;
  /**
   * Reads where a draft calls, the native coin it sends and the token approval it grants, from the
   * draft's bytes alone. A draft of another family, or bytes it cannot read, is an expected
   * failure: the venue host refuses what the family cannot read.
   */
  readDraft(draft: TxDraft): Result<DraftCall, "malformed_draft">;
}

/**
 * How a family's transactions are signed. The engine never trusts a signature blindly: it checks
 * that the signed transaction is the unsigned one, signed by its sender, before storing it.
 */
export interface SigningScheme {
  /** The id of the family whose transactions it checks. */
  readonly family: string;
  /** Checks a signed transaction against the unsigned one and gives its hash on chain. */
  verify(unsigned: UnsignedTx, signed: SignedTx): Result<TxHash, SignatureProblem>;
}

/** The chains binference may use, filled once by the composition root. */
export interface ChainRegistry {
  /** The chain with this id. An id the registry does not hold is an expected failure. */
  get(ref: ChainRef): Result<RegisteredChain, "unknown_chain">;
  /** Every chain the registry holds, in the order they were registered. */
  list(): readonly RegisteredChain[];
}
