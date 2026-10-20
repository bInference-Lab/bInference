import { createFakeVenue } from "@binference/chain/testing";
import type { Ratio } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testToken } from "../intents/test-intents.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { activeOrder, fillIntentsOf, startFillEngine, wholeToken } from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// The test coin at $600: micro-dollars a base unit.
const coinUsd: Ratio = { numerator: 600n, denominator: 10n ** 12n };

type LevelKind =
  | "limitBuyBelow"
  | "limitBuyAbove"
  | "limitSellAbove"
  | "limitSellBelow"
  | "takeProfit";

function requestOf(kind: LevelKind, price: bigint): OrderRequest {
  const base = testStopLoss();
  if (kind === "takeProfit") {
    return { ...base, kind: "takeProfit", trigger: { price } };
  }
  const direction = kind.endsWith("Below") ? "below" : "above";
  const side = kind.startsWith("limitBuy") ? "buy" : "sell";
  const size = side === "buy" ? { base: 10n ** 15n } : base.size;
  return { ...base, kind: "limit", side, size, trigger: { price, direction } };
}

function at(micros: bigint, pool: { readonly isThin: boolean }): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: pool.isThin,
    readAtMs: 0,
  };
}

// A quote's dollars of coin against its tokens, scaled so dollars per whole token compare as the
// fraction; at its expected output or at its minimum.
function priceOf(request: OrderRequest, record: IntentRecord, out: "expectedOut" | "minOut") {
  const quote = quoteDocument.decode(record.quote ?? null);
  const isBuy = request.side === "buy";
  const coin = isBuy ? quote.amountIn.base : quote[out].base;
  const tokens = isBuy ? quote[out].base : quote.amountIn.base;
  return { dollars: coin * coinUsd.numerator * wholeToken, tokens: tokens * coinUsd.denominator };
}

// What a filled intent breaks of its order's level and its default worst price, the trigger's.
function levelViolations(request: OrderRequest, record: IntentRecord): readonly string[] {
  const level = "price" in request.trigger ? request.trigger.price : 0n;
  const isAbove =
    request.kind === "takeProfit" ||
    (request.kind === "limit" && request.trigger.direction === "above");
  const expected = priceOf(request, record, "expectedOut");
  const worst = priceOf(request, record, "minOut");
  const meets = isAbove
    ? expected.dollars >= level * expected.tokens
    : expected.dollars <= level * expected.tokens;
  const isBuy = request.side === "buy";
  const holdsWorst = isBuy
    ? worst.dollars <= level * worst.tokens
    : worst.dollars >= level * worst.tokens;
  return [
    meets ? "" : "filled past its level",
    holdsWorst ? "" : "filled past its worst price",
  ].filter((text) => text !== "");
}

const cases = fc.record({
  kind: fc.constantFrom<LevelKind>(
    "limitBuyBelow",
    "limitBuyAbove",
    "limitSellAbove",
    "limitSellBelow",
    "takeProfit",
  ),
  price: fc.bigInt({ min: 300_000n, max: 1_500_000n }),
  rate: fc.record({
    numerator: fc.bigInt({ min: 1n, max: 4n * 10n ** 9n }),
    denominator: fc.bigInt({ min: 1n, max: 4n * 10n ** 9n }),
  }),
  isThin: fc.boolean(),
});

describe("a limit or take-profit fill, for every level, venue price and pool depth", () => {
  it("never fills at an expected price past its level, nor at its minimum past its trigger price", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async ({ kind, price, rate, isThin }) => {
        const test = await startFillEngine({ venues: [createFakeVenue({ rate })] });
        const request = requestOf(kind, price);
        await activeOrder(test, request);
        await test.engine.seePrice(at(price, { isThin }), live);
        const filled = (await fillIntentsOf(test)).filter(({ state }) => state === "paper_filled");
        expect(filled.flatMap((record) => levelViolations(request, record))).toStrictEqual([]);
      }),
      { numRuns: 80 },
    );
  });
});
