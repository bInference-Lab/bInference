import { BinferenceError } from "@binference/core";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";

/** The gate a fake reader of one chain passes each read through, which a test can close. */
export interface FakeChainGate {
  /**
   * Throws for an aborted signal, an account of another chain, and while the chain is down, as a
   * reader of one chain does.
   */
  readonly check: (account: AccountRef, signal: AbortSignal) => void;
  /** Every later read rejects as a chain that does not answer, until `up` is called. */
  readonly down: () => void;
  /** Reads answer again after `down`. */
  readonly up: () => void;
}

/** Creates the {@link FakeChainGate} of one chain, open at first. */
export function createFakeChainGate(chain: ChainRef): FakeChainGate {
  const state = { isDown: false };
  return {
    check: (account, signal) => {
      signal.throwIfAborted();
      if (accountRefParts(account).chain !== chain) {
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
    },
    down: () => {
      state.isDown = true;
    },
    up: () => {
      state.isDown = false;
    },
  };
}
