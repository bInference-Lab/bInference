import type { AccountKindReader } from "../addresses/ports.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import { createFakeChainGate, type FakeChainGate } from "./fake-chain-gate.js";

/** A fake reader whose chain a test can stop answering. */
export interface FakeAccountKindReader extends AccountKindReader, Omit<FakeChainGate, "check"> {}

/**
 * Creates an {@link AccountKindReader} for tests on one chain: the accounts given are no wallet,
 * every other account of the chain is one, and an account of another chain is a fault.
 */
export function createFakeAccountKindReader(options: {
  readonly chain: ChainRef;
  readonly notWallets: readonly AccountRef[];
}): FakeAccountKindReader {
  const gate = createFakeChainGate(options.chain);
  return {
    chain: options.chain,
    async read(account, { signal }) {
      gate.check(account, signal);
      return await Promise.resolve(options.notWallets.includes(account) ? "not_wallet" : "wallet");
    },
    down: gate.down,
    up: gate.up,
  };
}
