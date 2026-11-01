import type { Bridge } from "@binference/chain";
import { type Id, ok } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { expectOk } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall } from "../operations/test-engine.js";
import type { BridgeRoute } from "./hosted-bridge.js";
import { swapRateOf } from "./swap-rate.js";
import {
  type BridgeTest,
  bridgeEngine,
  testBridge,
  testOtherArrives,
  testRoute,
} from "./test-bridges.js";

const live = { signal: new AbortController().signal };
// The fake bridge keeps 1 of the 100 tokens sent, so the input less its fees is 99 tokens.
const net = 99_000_000n;

// The fake bridge, its least and expected output lowered by `gap` base units, as a swap into
// another token at a worse rate would quote.
function swappingWith(fake: Bridge, gap: bigint): Bridge {
  return {
    ...fake,
    quote: async (request, options) => {
      const quoted = await fake.quote(request, options);
      if (!quoted.ok) {
        return quoted;
      }
      const out = { ...quoted.value.minOut, base: quoted.value.minOut.base - gap };
      return ok({ ...quoted.value, minOut: out, expectedOut: out });
    },
  };
}

// A route the bridge fills by a swap into another token, its rate capped at `cap`.
const swapRoute = (cap: number): BridgeRoute => ({
  ...testRoute,
  arrives: testOtherArrives,
  swapCapBps: cap,
});

async function proposeSwap(gap: bigint, cap: number) {
  const routes = [swapRoute(cap)];
  const base = await bridgeEngine({ routes });
  const { test } = await bridgeEngine({ routes, bridge: swappingWith(base.bridge, gap) });
  const view = expectOk(await test.engine.handlers["intent/propose"](testCall(testBridge())));
  return { test, view };
}

// The reason a swap quote ends with: its rate past the route's cap first, then its least output
// below the agent's 2% floor; none when its card opens.
function reasonOf(gap: bigint, cap: number): string | undefined {
  if (gap * 10_000n > BigInt(cap) * net) {
    return "swap_rate";
  }
  return net - gap < 98_000_000n ? "price_impact" : undefined;
}

// Whether the stored rate is as the reason says: none for a refused quote; else the least whole
// basis point at or above the gap's share of the input less the fees.
function isStoredAsAsked(stored: number | undefined, gap: bigint, reason: string | undefined) {
  if (reason !== undefined || stored === undefined) {
    return reason !== undefined && stored === undefined;
  }
  const asked = gap * 10_000n;
  return BigInt(stored) * net >= asked && (BigInt(stored) - 1n) * net < asked;
}

// The swap rate of a quote of 100 tokens that keeps 1 as its fee, for the least output given.
const rateOf = (minOut: bigint) =>
  swapRateOf({
    amount: { asset: testRoute.leaves, base: 100_000_000n },
    fees: [{ kind: "relayer", amount: { asset: testRoute.leaves, base: 1_000_000n } }],
    minOut: { asset: testOtherArrives, base: minOut },
    decimals: testRoute.decimals,
  });

// The swap rate the intent's stored quote keeps, or none for an intent that stored no quote.
async function storedRateOf(test: BridgeTest["test"], intent: Id<"int">) {
  const record = await test.stores.intents.get(intent, live);
  return record?.quote === undefined
    ? undefined
    : bridgeQuoteDocument.decode(record.quote).swapRateBps;
}

describe("a bridge's swap rate", () => {
  it("is the share of the input less the fees the least output misses, rounded up", () => {
    const rates = [net, net + 5n, net - 1n, net - 495_000n, net - 495_001n, 0n].map(rateOf);
    expect(rates).toStrictEqual([0, 0, 1, 50, 51, 10_000]);
  });

  it("reads the swaps Relay quoted into USDG on 2026-11-01 within the 50 basis point cap", () => {
    // 20 USDC or USDT of 18 decimals sent, Relay's two fees, and the least USDG of 6 decimals.
    const recorded = [
      [5_568_086_059_578_812n + 101_993_677_850_355_842n, 19_889_586n],
      [5_543_465_957_313_108n + 102_006_767_118_324_780n, 19_867_950n],
    ] as const;
    const rates = recorded.map(([kept, minOut]) =>
      swapRateOf({
        amount: { asset: testRoute.leaves, base: 20n * 10n ** 18n },
        fees: [{ kind: "relayer", amount: { asset: testRoute.leaves, base: kept } }],
        minOut: { asset: testOtherArrives, base: minOut },
        decimals: { leaves: 18, arrives: 6 },
      }),
    );
    expect(rates).toStrictEqual([2, 13]);
  });

  it("opens no card for a quote over its route's cap or the agent's slippage limit", async () => {
    // The agent's slippage limit is 2% and the fake keeps 1%, so a gap past 1 token is below it.
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 0n, max: 2_500_000n }),
        fc.integer({ min: 0, max: 300 }),
        async (gap, cap) => {
          const { test, view } = await proposeSwap(gap, cap);
          const reason = reasonOf(gap, cap);
          expect(view.outcome?.reason).toBe(reason);
          expect(isStoredAsAsked(await storedRateOf(test, view.intent), gap, reason)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("shows on the card as its own line, under the fees", async () => {
    const { test, view } = await proposeSwap(120_000n, 50);
    const lines = await testCardText(test, view, "en");
    expect(lines).toContain("Swap rate: 0.13%");
    expect(lines.indexOf("Swap rate: 0.13%")).toBe(
      lines.findIndex((line) => line.startsWith("Bridge fees")) + 1,
    );
  });

  it("shows no line on a route that is not a swap", async () => {
    const { test } = await bridgeEngine();
    const view = expectOk(await test.engine.handlers["intent/propose"](testCall(testBridge())));
    const lines = await testCardText(test, view, "en");
    expect(lines.some((line) => line.startsWith("Swap rate"))).toBe(false);
  });
});
