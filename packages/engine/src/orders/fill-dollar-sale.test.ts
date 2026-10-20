import { createFakeVenue } from "@binference/chain/testing";
import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testToken } from "../intents/test-intents.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { activeOrder, fillIntentsOf, startFillEngine, wholeToken } from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// A venue that pays $1.20 a token, while the watcher reads $0.80.
const dollarTwenty = createFakeVenue({ rate: { numerator: 2n * 10n ** 9n, denominator: 1n } });
const eightyCents: WatchedOrderPrice = {
  token: testToken,
  usdPerBaseUnit: { numerator: 800_000n, denominator: wholeToken },
  decimals: 6,
  isThin: false,
  readAtMs: 0,
};

// The quote a fill intent stored, which a filled one has.
function quoteOf(record: IntentRecord | undefined): JsonValue {
  if (record?.quote === undefined) {
    throw new Error("Expected a filled intent with its quote.");
  }
  return record.quote;
}

describe("a sale sized in dollars", () => {
  it("sells its dollars at the fill's own quote, not at the trigger's price", async () => {
    const test = await startFillEngine({ venues: [dollarTwenty] });
    await activeOrder(test, testStopLoss({ size: { usdMicros: 400_000n } }));

    const outcomes = await test.engine.seePrice(eightyCents, live);

    const sold = (await fillIntentsOf(test)).find(({ state }) => state === "paper_filled");
    const quote = quoteDocument.decode(quoteOf(sold));
    expect(outcomes.map(({ outcome }) => outcome)).toStrictEqual(["filled"]);
    expect(quote.amountIn.base).toBe(333_333n);
  });
});
