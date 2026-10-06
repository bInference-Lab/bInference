import { err, ok, type Result } from "@binference/core";
import { type Address, getAddress } from "viem";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parses an EVM address into its EIP-55 checksum form. An address in one case carries no checksum
 * and is accepted; a mixed-case one must match its checksum, so a mistyped address is refused.
 */
export function parseEvmAddress(text: string): Result<Address, "malformed_address"> {
  if (!addressPattern.test(text)) {
    return err("malformed_address");
  }
  const digits = text.slice(2);
  const checksummed = getAddress(`0x${digits.toLowerCase()}`);
  const oneCase = digits === digits.toLowerCase() || digits === digits.toUpperCase();
  return oneCase || checksummed === text ? ok(checksummed) : err("malformed_address");
}
