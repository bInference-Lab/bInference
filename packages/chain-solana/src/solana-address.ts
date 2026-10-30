import { err, ok, type Result } from "@binference/core";
import { type Address, getAddressDecoder, getAddressEncoder, isAddress } from "@solana/kit";

/** The length of a Solana address in bytes: an Ed25519 public key or a program-derived address. */
export const solanaAddressBytes = 32;

/**
 * Parses a Solana address as a person or a bridge wrote it: base58 text that decodes to exactly
 * 32 bytes, through Solana's own codec. Base58 has one spelling per address, so the text that
 * passes is the canonical form. Anything else is an expected failure, never a throw.
 */
export function parseSolanaAddress(text: string): Result<Address, "malformed_address"> {
  return isAddress(text) ? ok(text) : err("malformed_address");
}

/**
 * The 32 bytes of a Solana address, as a ceiling or a bridge's deposit holds a recipient. Text that
 * is no Solana address is an expected failure.
 */
export function solanaAddressToBytes(text: string): Result<Uint8Array, "malformed_address"> {
  return isAddress(text)
    ? ok(Uint8Array.from(getAddressEncoder().encode(text)))
    : err("malformed_address");
}

/** The base58 address 32 bytes spell. Any other length is an expected failure. */
export function solanaAddressFromBytes(
  bytes: Readonly<Uint8Array>,
): Result<Address, "malformed_address"> {
  return bytes.length === solanaAddressBytes
    ? ok(getAddressDecoder().decode(bytes))
    : err("malformed_address");
}
