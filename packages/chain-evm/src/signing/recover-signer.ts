import { err, ok, type Result } from "@binference/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Address, type Hex, hexToBigInt, hexToBytes, toHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";

/** An ECDSA signature over secp256k1 as a typed transaction carries it. */
export interface EvmSignature {
  readonly r: Hex;
  readonly s: Hex;
  readonly yParity: number;
}

/**
 * Recovers the address that signed a 32-byte hash. A signature outside the curve's range, a
 * recovery bit other than 0 or 1, or a high `s`, which Ethereum refuses since EIP-2, is malformed.
 * viem recovers only asynchronously, so this uses the curve library viem itself builds on.
 */
export function recoverSigner(
  hash: Hex,
  signature: EvmSignature,
): Result<Address, "malformed_signature"> {
  if (signature.yParity !== 0 && signature.yParity !== 1) {
    return err("malformed_signature");
  }
  try {
    const parsed = new secp256k1.Signature(hexToBigInt(signature.r), hexToBigInt(signature.s));
    if (parsed.hasHighS()) {
      return err("malformed_signature");
    }
    const point = parsed.addRecoveryBit(signature.yParity).recoverPublicKey(hexToBytes(hash));
    return ok(publicKeyToAddress(toHex(point.toBytes(false))));
  } catch {
    return err("malformed_signature");
  }
}
