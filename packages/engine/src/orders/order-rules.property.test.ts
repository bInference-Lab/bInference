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

const requests: fc.Arbitrary<OrderRequest> = fc.record({
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
});

// Whether the size is one the rules let a fill of that side spend (decision 0189).
function isSizeAllowed(request: OrderRequest): boolean {
  const { size } = request;
  if ("usdMicros" in size) {
    return size.usdMicros > 0n;
  }
  const isSale = request.side === "sell";
  return "base" in size
    ? isSale && size.base > 0n
    : isSale && size.percentBps > 0 && size.percentBps <= bpsPerWhole;
}

// Whether every rule of decision 0189 holds, independently of how the checker is written.
function isAllowed(request: OrderRequest): boolean {
  const sells = request.kind === "limit" || request.side === "sell";
  const price = "price" in request.trigger ? request.trigger.price : 0n;
  return (
    request.token === testToken &&
    sells &&
    isSizeAllowed(request) &&
    price > 0n &&
    (request.expiresAt ?? testNowMs + 1) > testNowMs
  );
}

describe("the rules of a new auto order, for every request", () => {
  it("accepts exactly the requests every rule allows, and never a size, price or expiry of zero", () => {
    fc.assert(
      fc.property(requests, (request) => {
        const checked = checkOrderRequest(request, { nowMs: testNowMs, chains });
        expect(checked.ok).toBe(isAllowed(request));
      }),
      { numRuns: 2_000 },
    );
  });

  it("fills one fill and a 30-day expiry when the request names neither", () => {
    fc.assert(
      fc.property(requests.filter(isAllowed), (request) => {
        const { expiresAt: _expiresAt, ...open } = request;
        const checked = checkOrderRequest(open, { nowMs: testNowMs, chains });
        expect(checked).toMatchObject({
          ok: true,
          value: { expiresAtMs: testNowMs + defaultOrderLifetimeMs, maxFills: 1 },
        });
      }),
    );
  });
});
