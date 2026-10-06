import { venueQuoteSchema, type VenueQuote, assetRefSchema } from "@binference/chain";
import type { Bps } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { callVenue, ownCopy } from "./call-venue.js";

const clock = createManualClock(0);
const quote: VenueQuote = {
  expectedOut: { asset: assetRefSchema.parse("fake:1/slip44:1"), base: 5n },
  priceImpactBps: 10 as Bps,
};

async function hang(): Promise<number> {
  return await new Promise<number>(() => undefined);
}

describe("venue calls", () => {
  it("gives what the venue answers", async () => {
    const signal = new AbortController().signal;
    await expect(
      callVenue(async () => await Promise.resolve(7), { clock, signal, timeoutMs: 10 }),
    ).resolves.toStrictEqual({ ok: true, value: 7 });
  });

  it("rejects with the caller's reason on a signal already aborted, even if the venue hangs", async () => {
    const reason = new Error("stopped");
    await expect(
      callVenue(hang, { clock, signal: AbortSignal.abort(reason), timeoutMs: 10 }),
    ).rejects.toBe(reason);
  });

  it("gives its own copy of a value that fits the schema, and nothing for one that breaks it", () => {
    const copy = ownCopy(venueQuoteSchema, quote);
    expect(copy).toStrictEqual(quote);
    expect(copy).not.toBe(quote);
    expect(copy?.expectedOut).not.toBe(quote.expectedOut);
    expect(ownCopy(venueQuoteSchema, { ...quote, priceImpactBps: 10_001 as Bps })).toBeUndefined();
  });
});
