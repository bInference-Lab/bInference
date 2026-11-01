import { type Hex, recoverMessageAddress } from "viem";
import { relaySolver } from "../relay-chains.js";

/**
 * Whether Relay's solver signed the order id, as Relay's input validation guide asks: the quote's
 * `protocol.v2.orderSignature` is an EIP-191 signature over the id's 32 bytes, and the key that
 * made it must be the solver this plugin names, never one the answer names. A missing or
 * malformed signature is `false`.
 */
export async function isSignedBySolver(orderId: Hex, signature: Hex | undefined): Promise<boolean> {
  if (signature === undefined) {
    return false;
  }
  try {
    const signer = await recoverMessageAddress({ message: { raw: orderId }, signature });
    return signer.toLowerCase() === relaySolver;
  } catch {
    return false;
  }
}
