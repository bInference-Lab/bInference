import { type AccountRef, accountRefSchema, type ChainRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { bytesToHex, getAddress } from "viem";

const seedBytes = 32;
const addressBytes = 20;

/**
 * An EVM account on `chain` whose address is the first 20 bytes of `seed`, in EIP-55 form. No key
 * is derived: the account is for simulations, which sign nothing. A seed under 32 bytes is a
 * `chain.short_seed` fault.
 */
export function freshEvmAccount(chain: ChainRef, seed: Readonly<Uint8Array>): AccountRef {
  if (seed.length < seedBytes) {
    throw new BinferenceError({
      code: "chain.short_seed",
      message: "A fresh account needs at least 32 random bytes.",
    });
  }
  const address = getAddress(bytesToHex(seed.subarray(0, addressBytes)));
  return accountRefSchema.parse(`${chain}:${address}`);
}
