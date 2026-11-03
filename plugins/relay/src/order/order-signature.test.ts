import { BinferenceError } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { type RelayQuote, readQuoteAnswer } from "../api/quote-answer.schema.js";
import { relaySolver } from "../relay-chains.js";
import usdcToBase from "../testing/recorded/quote-usdc-base.json" with { type: "json" };
import usdcToRobinhood from "../testing/recorded/quote-usdc-robinhood.json" with { type: "json" };
import usdcToSolana from "../testing/recorded/quote-usdc-solana.json" with { type: "json" };
import usdtToRobinhood from "../testing/recorded/quote-usdt-robinhood.json" with { type: "json" };
import { isSignedBySolver } from "./order-signature.js";

function readRecorded(answer: object): RelayQuote {
  const quote = readQuoteAnswer(JSON.stringify(answer));
  if (quote === undefined) {
    throw new BinferenceError({ code: "relay.bad_fixture", message: "A recorded quote reads." });
  }
  return quote;
}

const recorded = [usdcToBase, usdcToSolana, usdcToRobinhood, usdtToRobinhood].map(readRecorded);
const toBase = readRecorded(usdcToBase);

describe("the solver's signature over an order id", () => {
  it.each(recorded)("holds for each recorded quote's order", async (quote) => {
    await expect(isSignedBySolver(quote.orderId, quote.orderSignature, relaySolver)).resolves.toBe(
      true,
    );
  });

  it("fails for another order id, a missing signature or bytes that are none", async () => {
    const other = `0x${"44".repeat(32)}` as const;
    await expect(isSignedBySolver(other, toBase.orderSignature, relaySolver)).resolves.toBe(false);
    await expect(isSignedBySolver(toBase.orderId, undefined, relaySolver)).resolves.toBe(false);
    await expect(isSignedBySolver(toBase.orderId, "0x1234", relaySolver)).resolves.toBe(false);
  });
});
