import { BinferenceError } from "@binference/core";
import { z } from "zod";
import type { AccountRef } from "../caip/account-ref.js";
import type { NonceSource } from "../ports.js";

/**
 * A nonce source for tests, shaped like a node read at `pending`: the test moves each account's
 * count as blocks would. It holds only the accounts the test set.
 */
export interface FakeNonceSource extends NonceSource {
  /** Sets the next nonce the chain expects from an account, from now on. */
  set(account: AccountRef, next: number): void;
}

const nonceSchema = z.int().nonnegative();

function checked(next: number): number {
  if (!nonceSchema.safeParse(next).success) {
    throw new BinferenceError({
      code: "chain.bad_nonce",
      message: "A nonce is a safe integer at 0 or above.",
      details: { next },
    });
  }
  return next;
}

/** Creates a {@link FakeNonceSource} with the given counts; any other account counts 0. */
export function createFakeNonceSource(counts: ReadonlyMap<AccountRef, number>): FakeNonceSource {
  const nexts = new Map(counts);
  for (const next of nexts.values()) {
    checked(next);
  }
  return {
    async next(account, options) {
      options.signal.throwIfAborted();
      return await Promise.resolve(nexts.get(account) ?? 0);
    },
    set(account, next) {
      nexts.set(account, checked(next));
    },
  };
}
