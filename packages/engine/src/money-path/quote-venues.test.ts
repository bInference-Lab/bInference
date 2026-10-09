import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import { createVenueHost, type QuoteOutcome } from "../venues/venue-host.js";
import { firstQuoteOf, quoteVenues, quoteWaitMs } from "./quote-venues.js";
import type { SwapTrade } from "./swap-trade.js";
import { otherVenue, otherVenueId } from "./test-routes.js";

const swap: SwapTrade = {
  trade: {
    venue: "fake-swap",
    wallet: testAccount,
    amountIn: { asset: testCoin, base: 1_000_000n },
    assetOut: testToken,
    maxSlippageBps: bpsSchema.parse(50),
  },
  venues: ["fake-swap", otherVenueId],
};

// The second venue never answers; it is skipped once the wait runs out.
const silentOther = {
  ...otherVenue({ numerator: 3n, denominator: 1n }),
  quote: async () => new Promise<never>(() => undefined),
};

// Each answer as the venue that quoted, or as the refusal.
function venuesOf(answers: readonly QuoteOutcome[]): readonly string[] {
  return answers.map((answer) => (answer.ok ? answer.value.trade.venue : answer.error));
}

function quoting(
  venues: readonly Venue[] = [createFakeVenue(), otherVenue({ numerator: 3n, denominator: 1n })],
) {
  const clock = createManualClock(testNowMs);
  const host = createVenueHost({
    venues,
    chains: testChains([otherVenueId]),
    clock,
    callTimeoutMs: 5_000,
  });
  return {
    clock,
    quote: async (signal: AbortSignal) => quoteVenues(swap, { host, clock, signal }),
  };
}

describe("quoting every venue", () => {
  it("asks every venue the agent allows and answers in the agent's venue order", async () => {
    const answers = await quoting().quote(new AbortController().signal);
    expect(venuesOf(answers)).toStrictEqual(["fake-swap", otherVenueId]);
    expect(answers).toMatchObject([
      { value: { quote: { expectedOut: { base: 2_000_000n } } } },
      { value: { quote: { expectedOut: { base: 3_000_000n } } } },
    ]);
  });

  it("skips a venue that has not answered within the wait, and keeps the others", async () => {
    const { clock, quote } = quoting([createFakeVenue(), silentOther]);
    const answering = quote(new AbortController().signal);
    await clock.advance(quoteWaitMs);
    const answers = await answering;
    expect(venuesOf(answers)).toStrictEqual(["fake-swap", "venue_down"]);
  });

  it("rejects with the caller's reason once the caller stops", async () => {
    const { quote } = quoting([createFakeVenue(), silentOther]);
    const controller = new AbortController();
    const answering = quote(controller.signal);
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(answering).rejects.toBe(reason);
  });

  it("prices the policy from the first venue that quoted, else the first refusal", () => {
    const refusal = { ok: false, error: "no_route" } as const;
    const down = { ok: false, error: "venue_down" } as const;
    expect(firstQuoteOf([refusal, down])).toBe(refusal);
    expect(firstQuoteOf([])).toStrictEqual(down);
  });
});
