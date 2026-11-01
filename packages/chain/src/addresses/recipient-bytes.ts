import { err, ok, type Result } from "@binference/core";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { FamilyRegistry } from "./family-registry.js";

const lowerHex = /^0x(?:[0-9a-f]{2})+$/;

/** Bytes as lowercase hex after `0x`, the form the address book stores recipient bytes in. */
export function recipientHex(bytes: Readonly<Uint8Array>): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

/** The bytes lowercase hex after `0x` spells; any other text is an expected failure. */
export function recipientHexBytes(text: string): Result<Uint8Array, "malformed_hex"> {
  return lowerHex.test(text)
    ? ok(Uint8Array.from(Buffer.from(text.slice(2), "hex")))
    : err("malformed_hex");
}

/**
 * An account's recipient bytes as {@link recipientHex} writes them, through its namespace's codec
 * (decision 0298): 20 bytes for an EVM address, 32 for a Solana one. A namespace no family serves
 * is `unknown_family`, an address its codec refuses `malformed_address`.
 */
export function recipientBytesOf(
  families: FamilyRegistry,
  account: AccountRef,
): Result<string, "unknown_family" | "malformed_address"> {
  const { chain, address } = accountRefParts(account);
  const codec = families.codecOf(chain);
  if (!codec.ok) {
    return codec;
  }
  const bytes = codec.value.toBytes(address);
  return bytes.ok ? ok(recipientHex(bytes.value)) : bytes;
}
