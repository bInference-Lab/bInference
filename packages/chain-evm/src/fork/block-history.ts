import { getAddress, toHex } from "viem";
import type { Fork } from "./open-fork.js";

// EIP-2935's history contract, at the same address on every chain that runs it, BSC among them.
// Before each block, the node writes the parent block's hash into its slot `(number - 1) % 8191`.
const historyContract = getAddress("0x0000F90827F1C53a10cb7a02335B175320002935");
const historyWindow = 8_191n;
const emptyWord = toHex(0n, { size: 32 });

/**
 * Sets, on the fork, the history contract's slots that the next `count` mined blocks will write.
 * anvil reads a slot's old value from the fork's upstream before it writes it, and a public node
 * keeps the fork block's state for about a minute: past that, a mined block whose slot was never
 * read makes anvil panic on `missing trie node`. A slot set here is never read from upstream.
 */
export async function holdBlockHistory(fork: Fork, count: number): Promise<void> {
  const head = await fork.client.getBlockNumber();
  const slots = Array.from({ length: count }, (_, index) =>
    toHex((head + BigInt(index)) % historyWindow, { size: 32 }),
  );
  await Promise.all(
    slots.map(async (slot) => fork.call("anvil_setStorageAt", [historyContract, slot, emptyWord])),
  );
}
