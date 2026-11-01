import type { AccountKindReader, AddressCodec, ChainRef } from "@binference/chain";

/**
 * A chain a bridge delivers to, where the address book may save an address besides the chains of
 * the agent's wallets (decision 0297).
 */
export interface DestinationChain {
  readonly ref: ChainRef;
  /** The address codec of its family (decision 0298). */
  readonly codec: AddressCodec;
  /**
   * Reads whether an address there is a wallet, on a chain whose accounts may be programs or
   * token accounts, such as Solana; none where every address can hold what it is paid.
   */
  readonly kinds?: AccountKindReader;
}
