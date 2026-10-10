import { keccak256, toHex } from "viem";

/**
 * The key of the crash suite's wallet named `name`, made from fixed words, so no key is written
 * down anywhere and each run trades from a wallet of its own: whatever reached the chain from it,
 * that run sent.
 */
export function crashWalletKey(name: string): `0x${string}` {
  return keccak256(toHex(`binference crash wallet ${name}`));
}
