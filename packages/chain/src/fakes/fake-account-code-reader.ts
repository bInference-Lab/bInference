import type { AccountCode, AccountCodeReader } from "../addresses/ports.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import { createFakeChainGate, type FakeChainGate } from "./fake-chain-gate.js";

/** A fake reader whose accounts' code a test sets, and whose chain it can stop answering. */
export interface FakeAccountCodeReader extends AccountCodeReader, Omit<FakeChainGate, "check"> {
  /** The account holds this code from now on. */
  place(account: AccountRef, code: AccountCode): void;
}

/**
 * Creates an {@link AccountCodeReader} for tests on one chain: each account given holds its code,
 * every other account of the chain none, and an account of another chain is a fault.
 */
export function createFakeAccountCodeReader(options: {
  readonly chain: ChainRef;
  readonly codes?: ReadonlyMap<AccountRef, AccountCode>;
}): FakeAccountCodeReader {
  const codes = new Map(options.codes);
  const gate = createFakeChainGate(options.chain);
  return {
    chain: options.chain,
    async read(account, { signal }) {
      gate.check(account, signal);
      return await Promise.resolve(codes.get(account) ?? "none");
    },
    place: (account, code) => {
      codes.set(account, code);
    },
    down: gate.down,
    up: gate.up,
  };
}
