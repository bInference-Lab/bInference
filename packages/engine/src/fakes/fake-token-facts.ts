import type { AssetRef } from "@binference/chain";
import type { ReadTokenFacts, TokenFacts } from "../money-path/token-facts.js";

/** A {@link ReadTokenFacts} for tests, and the tokens it was asked about. */
export interface FakeTokenFacts {
  readonly read: ReadTokenFacts;
  /** Each read's tokens, oldest first. */
  reads(): readonly (readonly AssetRef[])[];
}

/** What {@link createFakeTokenFacts} answers. */
export interface FakeTokenFactsOptions {
  /** Facts of named tokens; every other token answers {@link fakeTokenFacts}. */
  readonly facts?: ReadonlyMap<AssetRef, TokenFacts>;
  /** Tokens that answer no symbol or decimals, and are left out of every read. */
  readonly unreadable?: readonly AssetRef[];
}

/** What a token the fake does not name answers: `UNL`, 18 decimals. */
export const fakeTokenFacts: TokenFacts = { symbol: "UNL", name: "Unlisted", decimals: 18 };

/**
 * Creates a {@link FakeTokenFacts} that reads no chain: a named token answers its facts, an
 * unreadable one nothing, and any other {@link fakeTokenFacts}.
 */
export function createFakeTokenFacts(options: FakeTokenFactsOptions = {}): FakeTokenFacts {
  const reads: (readonly AssetRef[])[] = [];
  const unreadable = new Set(options.unreadable ?? []);
  return {
    read: async (tokens, { signal }) => {
      signal.throwIfAborted();
      reads.push(tokens);
      const answered = tokens.flatMap((token) =>
        unreadable.has(token)
          ? []
          : [[token, options.facts?.get(token) ?? fakeTokenFacts] as const],
      );
      return await Promise.resolve(new Map(answered));
    },
    reads: () => [...reads],
  };
}
