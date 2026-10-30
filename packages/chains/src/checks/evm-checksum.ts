import { createHash } from "node:crypto";

const hexAddress = /^0x[0-9a-fA-F]{40}$/;

// EIP-55: a hex letter is upper case where the same nibble of the Keccak-256 hash of the lower
// case address is 8 or more. Node's own Keccak-256 keeps viem out of this package.
function toChecksumAddress(address: string): string {
  const hex = address.slice(2).toLowerCase();
  const hash = createHash("keccak-256").update(hex).digest("hex");
  const letters = hex
    .split("")
    .map((char, index) => ("89abcdef".includes(hash.charAt(index)) ? char.toUpperCase() : char));
  return `0x${letters.join("")}`;
}

/**
 * Whether a text is a 20-byte hex address written in its EIP-55 checksum form. Test support: chain
 * data is checked, never converted, at run time.
 */
export function isChecksummed(address: string): boolean {
  return hexAddress.test(address) && toChecksumAddress(address) === address;
}
