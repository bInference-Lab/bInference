import { err, type Id, type Result } from "@binference/core";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { QuoteSource } from "../ports.js";

/** A quote source for tests that answers from a fixed table and never asks a venue. */
export interface FakeQuoteSource extends QuoteSource {
  /** The intents it was asked to quote again, oldest first, up to the last 1,000. */
  asked(): readonly Id<"int">[];
}

const maxAsked = 1_000;

/**
 * Creates a {@link FakeQuoteSource}. An intent missing from the table has `no_route`. It keeps the
 * last 1,000 intents it was asked for and drops older ones.
 */
export function createFakeQuoteSource(
  quotes: ReadonlyMap<Id<"int">, Result<BuiltQuote, QuoteFailure>>,
): FakeQuoteSource {
  const asked: Id<"int">[] = [];
  return {
    async requote(intent, options): Promise<Result<BuiltQuote, QuoteFailure>> {
      options.signal.throwIfAborted();
      asked.push(intent);
      if (asked.length > maxAsked) {
        asked.shift();
      }
      return await Promise.resolve(quotes.get(intent) ?? err("no_route"));
    },
    asked: () => [...asked],
  };
}
