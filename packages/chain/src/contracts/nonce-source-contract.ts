import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AccountRef } from "../caip/account-ref.js";
import type { NonceSource } from "../ports.js";

/** A nonce source under test, an account its chain counts transactions for, and one it never saw. */
export interface NonceSourceSubject {
  readonly source: NonceSource;
  /** An account with transactions, and the next nonce its chain expects from it. */
  readonly known: { readonly account: AccountRef; readonly next: number };
  /** An account the chain has never seen. */
  readonly unseen: AccountRef;
}

/** Makes a fresh {@link NonceSourceSubject} for each check. */
export interface NonceSourceHarness {
  create(): Promise<NonceSourceSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `NonceSource` adapter passes. */
export function nonceSourceContract(harness: NonceSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "gives an account the next nonce its chain expects",
      run: async () => {
        const { source, known } = await harness.create();
        assert.equal(await source.next(known.account, live()), known.next);
      },
    },
    {
      name: "gives 0 for an account the chain has never seen",
      run: async () => {
        const { source, unseen } = await harness.create();
        assert.equal(await source.next(unseen, live()), 0);
      },
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => {
        const { source, known } = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          source.next(known.account, { signal: AbortSignal.abort(reason) }),
          reason,
        );
      },
    },
  ];
}
