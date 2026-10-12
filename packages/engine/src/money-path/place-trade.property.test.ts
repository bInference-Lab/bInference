import { createFakeVenue } from "@binference/chain/testing";
import { type Bps, bpsPerWhole } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import {
  startTestEngine,
  testAccount,
  testCall,
  testCallers,
  testChains,
  type TestEngine,
} from "../operations/test-engine.js";
import { createVenueHost } from "../venues/venue-host.js";
import { placeTrade } from "./place-trade.js";
import type { TradeAsk } from "./swap-trade.js";

const chains = testChains();
const host = createVenueHost({
  venues: [createFakeVenue()],
  chains,
  clock: createManualClock(testNowMs),
  callTimeoutMs: 5_000,
});
const whole = BigInt(bpsPerWhole);
const share = fc.integer({ min: 0, max: bpsPerWhole }).map((bps) => bps as Bps);

// A sale of nothing has nothing to sell; any other is placed.
function refusalFor(sold: bigint): string | undefined {
  return sold === 0n ? "nothing_to_sell" : undefined;
}

// What a proposal's quote sells; a refusal sells nothing, and a protocol error fails the test.
function soldOf(
  proposed: Awaited<ReturnType<TestEngine["engine"]["handlers"]["intent/propose"]>>,
): bigint {
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value.quote?.amountIn.base ?? 0n;
}

function saleOf(percentBps: Bps): TradeAsk {
  return { kind: "sell", assetIn: testToken, amount: { percentBps }, placed: testToken };
}

describe("a sale by share, placed", () => {
  it("never sells more than the wallet holds, nor less than its share by a whole unit", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 0n, max: 2n ** 128n }), share, async (heldBase, bps) => {
        const placed = await placeTrade(saleOf(bps), {
          limits: testLimits,
          account: testAccount,
          chains,
          host,
          nativeAsset: testCoin,
          holdings: { held: async () => await Promise.resolve(heldBase) },
          wallet: testWallet,
          isPaper: true,
          signal: new AbortController().signal,
        });
        const sold = placed.swap.trade.amountIn.base;
        const shortfall = heldBase * BigInt(bps) - sold * whole;
        expect(sold).toBeLessThanOrEqual(heldBase);
        expect(shortfall).toBeGreaterThanOrEqual(0n);
        expect(shortfall).toBeLessThan(whole);
        expect(placed.refusal).toBe(refusalFor(sold));
      }),
    );
  });

  // Up to $1,000 of the token at $1, so the per-trade cap never refuses a sale; a share that rounds
  // to nothing ends `nothing_to_sell` with no quote, and the position stays whole.
  it("fills a paper sale by share at its rounded-down share, leaving the rest", async () => {
    const prices = new Map([
      [testCoin, { numerator: 600n, denominator: 10n ** 12n }],
      [testToken, { numerator: 1n, denominator: 1n }],
    ]);
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 1n, max: 10n ** 9n }), share, async (heldBase, bps) => {
        const test = await startTestEngine({
          agent: { approvalMode: "auto" },
          prices,
          paper: [
            { asset: testCoin, base: 10n ** 18n },
            { asset: testToken, base: heldBase },
          ],
        });
        const request = {
          kind: "sell",
          agent: testAgent,
          wallet: testWallet,
          reason: "Trim",
          token: testToken,
          amount: { percentBps: bps },
        } as const;
        const proposed = await test.engine.handlers["intent/propose"](
          testCall(request, testCallers.runtime),
        );
        const positions = await test.positions.positions(
          { walletId: testWallet, isPaper: true },
          { signal: new AbortController().signal },
        );
        const left = positions.find((position) => position.asset === testToken)?.quantityBase;
        const sold = soldOf(proposed);
        expect(sold).toBe((heldBase * BigInt(bps)) / whole);
        expect(left).toBe(heldBase - sold);
      }),
      { numRuns: 40 },
    );
  });
});
