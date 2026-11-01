import type { AddressCodec } from "@binference/chain";
import {
  parseSolanaAddress,
  solanaAddressBytes,
  solanaAddressFromBytes,
  solanaAddressToBytes,
} from "./solana-address.js";
import { solanaNamespace } from "./solana-ids.js";

/**
 * Solana's address codec (decision 0298): base58 text that decodes to exactly 32 bytes, through
 * Solana's own codec, whose recipient bytes are those 32. Base58 has one spelling per address, so
 * the text that passes is its canonical form. With no checksum, a typo can still pass: every card
 * shows a Solana address whole.
 */
export function createSolanaAddressCodec(): AddressCodec {
  return {
    namespace: solanaNamespace,
    recipientLength: solanaAddressBytes,
    parse: parseSolanaAddress,
    toBytes: solanaAddressToBytes,
    fromBytes: solanaAddressFromBytes,
  };
}
