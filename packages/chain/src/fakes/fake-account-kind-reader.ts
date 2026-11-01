import { BinferenceError } from "@binference/core";
import type { AccountKindReader } from "../addresses/ports.js";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";

/** A fake reader whose chain a test can stop answering. */
export interface FakeAccountKindReader extends AccountKindReader {
  /** Every later read rejects as a chain that does not answer, until `up` is called. */
  down(): void;
  /** Reads answer again after `down`. */
  up(): void;
}

/**
 * Creates an {@link AccountKindReader} for tests on one chain: the accounts given are no wallet,
 * every other account of the chain is one, and an account of another chain is a fault.
 */
export function createFakeAccountKindReader(options: {
  readonly chain: ChainRef;
  readonly notWallets: readonly AccountRef[];
}): FakeAccountKindReader {
  const state = { isDown: false };
  return {
    chain: options.chain,
    async read(account, { signal }) {
      signal.throwIfAborted();
      if (accountRefParts(account).chain !== options.chain) {
        throw new BinferenceError({
          code: "chain.unknown_chain",
          message: "This reader reads one chain only.",
        });
      }
      if (state.isDown) {
        throw new BinferenceError({
          code: "chain.unreachable",
          message: "The fake chain does not answer.",
          retryable: true,
        });
      }
      return await Promise.resolve(options.notWallets.includes(account) ? "not_wallet" : "wallet");
    },
    down: () => {
      state.isDown = true;
    },
    up: () => {
      state.isDown = false;
    },
  };
}
