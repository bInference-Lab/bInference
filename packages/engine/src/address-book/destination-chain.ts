import type {
  AccountCodeReader,
  AccountKindReader,
  AddressCodec,
  ChainRef,
} from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";

/**
 * A chain a bridge delivers to, where the address book may save an address besides the chains of
 * the agent's wallets (decision 0297).
 */
export interface DestinationChain {
  readonly ref: ChainRef;
  /** The registry's name of the chain, as a card names it, such as Base. */
  readonly name: string;
  /** The registry's info of its coin and each token it lists, which a bridge may deliver. */
  readonly assets: AssetInfos;
  /** The address codec of its family (decision 0298). */
  readonly codec: AddressCodec;
  /**
   * Reads whether an address there is a wallet, on a chain whose accounts may be programs or
   * token accounts, such as Solana; none where every address can hold what it is paid.
   */
  readonly kinds?: AccountKindReader;
  /**
   * Reads what code an address there holds, on an EVM chain (decision 0318): a token is refused
   * as a payee, and the rescue address is paid there only while it holds none.
   */
  readonly codes?: AccountCodeReader;
}
