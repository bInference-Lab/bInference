import { type Address, type Hex, recoverMessageAddress } from "viem";

/**
 * Whether Relay's solver signed the order id, as Relay's input validation guide asks: the quote's
 * `protocol.v2.orderSignature` is an EIP-191 signature over the id's 32 bytes, and the key that
 * made it must be the solver the bridge's options name, never one the answer names. A missing or
 * malformed signature is `false`.
 */
export async function isSignedBySolver(
  orderId: Hex,
  signature: Hex | undefined,
  solver: Address,
): Promise<boolean> {
  if (signature === undefined) {
    return false;
  }
  try {
    const signer = await recoverMessageAddress({ message: { raw: orderId }, signature });
    return signer.toLowerCase() === solver.toLowerCase();
  } catch {
    return false;
  }
}
