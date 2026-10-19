import { type AssetRef, assetRefSchema } from "@binference/chain";
import { type Bps, bpsPerWhole } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { checkOrderRequest, defaultOrderLifetimeMs } from "./order-rules.js";

const chains = testChains();

const sizes = fc.oneof(
  fc.bigInt({ min: 0n, max: 2n ** 70n }).map((base) => ({ base })),
  fc.bigInt({ min: 0n, max: 2n ** 70n }).map((usdMicros) => ({ usdMicros })),
  fc.integer({ min: 0, max: 20_000 }).map((percentBps) => ({ percentBps: percentBps as Bps })),
);

// A token no registry lists.
const unlisted: AssetRef = assetRefSchema.parse("fake:1/token:0x0000000f");

const requests: fc.Arbitrary<OrderRequest> = fc.record(
  {
    kind: fc.constantFrom("limit" as const, "takeProfit" as const, "stopLoss" as const),
    agent: fc.constant(testAgent),
    token: fc.constantFrom(testToken, testCoin),
    side: fc.constantFrom("buy" as const, "sell" as const),
    size: sizes,
    trigger: fc.record({
      price: fc.bigInt({ min: 0n, max: 2n ** 70n }),
      direction: fc.constantFrom("above" as const, "below" as const),
    }),
    expiresAt: fc.integer({ min: testNowMs - 10, max: testNowMs + 10 }),
    spend: fc.constantFrom(testCoin, testToken, unlisted),
  },
  { requiredKeys: ["kind", "agent", "token", "side", "size", "trigger", "expiresAt"] },
);

// Whether the size is one the rules let a fill spend or sell (decisions 0189 and 0190).
function isSizeAllowed(request: OrderRequest): boolean {
  const { size } = request;
  if ("usdMicros" in size) {
    return size.usdMicros > 0n;
  }
  return "base" in size ? size.base > 0n : size.percentBps > 0 && size.percentBps <= bpsPerWhole;
}

// A sale names nothing to spend; a buy spends the chain's coin, by default, or a listed token
// other than the one it buys. The fake chain lists one token, the one every allowed order trades.
function isSpendAllowed(request: OrderRequest): boolean {
  return request.side === "sell"
    ? request.spend === undefined
    : request.spend === undefined || request.spend === testCoin;
}

// Whether every rule of decision 0189 holds, independently of how the checker is written.
function isAllowed(request: OrderRequest): boolean {
  const sells = request.kind === "limit" || request.side === "sell";
  const price = "price" in request.trigger ? request.trigger.price : 0n;
  return (
    request.token === testToken &&
    sells &&
    isSizeAllowed(request) &&
    isSpendAllowed(request) &&
    price > 0n &&
    (request.expiresAt ?? testNowMs + 1) > testNowMs
  );
}

// What the checked order spends, as the rules filled it.
function filledSpendOf(checked: ReturnType<typeof checkOrderRequest>): AssetRef | undefined {
  if (!checked.ok) {
    throw new Error("Expected an order that passed its rules.");
  }
  return checked.value.request.spend;
}

// A buy that names nothing to spend spends the chain's coin; a sale spends nothing.
const defaultSpendOf = (request: OrderRequest): AssetRef | undefined =>
  request.side === "buy" ? testCoin : undefined;

describe("the rules of a new auto order, for every request", () => {
  it("accepts exactly the requests every rule allows, and never a size, price or expiry of zero", () => {
    fc.assert(
      fc.property(requests, (request) => {
        const checked = checkOrderRequest(request, { nowMs: testNowMs, chains, ownerZone: "UTC" });
        expect(checked.ok).toBe(isAllowed(request));
      }),
      { numRuns: 2_000 },
    );
  });

  it("fills one fill and a 30-day expiry when the request names neither", () => {
    fc.assert(
      fc.property(requests.filter(isAllowed), (request) => {
        const { expiresAt: _expiresAt, ...open } = request;
        const checked = checkOrderRequest(open, { nowMs: testNowMs, chains, ownerZone: "UTC" });
        expect(checked).toMatchObject({
          ok: true,
          value: { expiresAtMs: testNowMs + defaultOrderLifetimeMs, maxFills: 1 },
        });
        expect(filledSpendOf(checked)).toBe(defaultSpendOf(request));
      }),
    );
  });
});
