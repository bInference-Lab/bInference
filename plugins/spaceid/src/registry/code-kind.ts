import type { Hex } from "viem";

/**
 * What an account's code says about it: `none` for a plain account, `delegation` for a
 * smart-account wallet whose code is exactly an EIP-7702 delegation designator, `other` for any
 * other code, a contract's.
 */
export type CodeKind = "none" | "delegation" | "other";

// EIP-7702's designator: 0xef0100 followed by the delegate's 20-byte address, nothing else.
const delegationDesignator = /^0xef0100[0-9a-f]{40}$/i;

/** Reads an account's code as a {@link CodeKind}. */
export function codeKindOf(code: Hex): CodeKind {
  if (code === "0x") {
    return "none";
  }
  return delegationDesignator.test(code) ? "delegation" : "other";
}
