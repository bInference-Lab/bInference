import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { Quoter } from "../venues/ports.js";
import { type QuoteRequest, venueQuoteSchema } from "../venues/venue-quote.js";

/** A quoter under test, a request it can route and one it cannot. */
export interface QuoterSubject {
  readonly quoter: Quoter;
  readonly request: QuoteRequest;
  /** A request for a pair the venue has no route for. */
  readonly unroutable: QuoteRequest;
}

/** Makes a fresh {@link QuoterSubject} for each check. */
export interface QuoterHarness {
  create(): QuoterSubject;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `Quoter` passes. */
export function quoterContract(harness: QuoterHarness): readonly ContractCheck[] {
  return [
    {
      name: "quotes the asset asked for above zero",
      run: async () => {
        const { quoter, request } = harness.create();
        const quote = await quoter.quote(request, { signal: live() });
        assert.ok(quote.ok);
        assert.equal(quote.value.expectedOut.asset, request.assetOut);
        assert.ok(quote.value.expectedOut.base > 0n);
        assert.ok(venueQuoteSchema.safeEncode(quote.value).success);
      },
    },
    {
      name: "answers a pair it cannot route as no route",
      run: async () => {
        const { quoter, unroutable } = harness.create();
        const quote = await quoter.quote(unroutable, { signal: live() });
        assert.deepEqual(quote, { ok: false, error: "no_route" });
      },
    },
    {
      name: "refuses to quote on an aborted signal",
      run: async () => {
        const { quoter, request } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(quoter.quote(request, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
