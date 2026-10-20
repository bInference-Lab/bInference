import type { ChainRef } from "@binference/plugin-sdk";
import type { Address, Hex } from "viem";

/** A create call the launcher built, as its decoder finds the token it makes. */
export function builtKeyOf(
  chain: ChainRef,
  call: {
    readonly from: Address;
    readonly to: Address;
    readonly value: bigint;
    readonly data: Hex;
  },
): string {
  return [chain, call.from, call.to, call.value.toString(), call.data].join("|").toLowerCase();
}
