import type { PriceRead, Result } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { type RecordedCall, recordedCalls } from "../testing/recorded-answers.js";
import { scriptedChain } from "../testing/recorded-chain.js";
import {
  bnb,
  contractsWith,
  graduatedToken,
  olderCurve,
  partsOver,
  registryContracts,
  sellableAnswer,
  stackCurve,
  stackToken,
} from "../testing/venue-fixtures.js";
import { readCurvePrice } from "./read-curve-price.js";

const live = (): AbortSignal => new AbortController().signal;
const reservesKey = `${stackCurve.toLowerCase()}|0x0902f1ac`;
const sellableKey = `${stackCurve.toLowerCase()}|0x808bcddc`;

function resultOf(key: string, answers: ReadonlyMap<string, RecordedCall> = recordedCalls): string {
  const answer = answers.get(key);
  if (answer === undefined || !("result" in answer)) {
    throw new Error(`No recorded result for ${key}.`);
  }
  return answer.result;
}

function readOf(result: Result<PriceRead, "no_price_read">): PriceRead {
  if (!result.ok) {
    throw new Error("The venue gave no price read.");
  }
  return result.value;
}

async function priceReadOf(token = stackToken, contracts = contractsWith(stackCurve)) {
  return readCurvePrice({ token, contracts }, partsOver(scriptedChain()), live());
}

describe("geniusfun price read", () => {
  it("reads a curve's reserves and its supply left, and prices by the reserves", async () => {
    const read = readOf(await priceReadOf());
    expect(read).toMatchObject({
      quoteAsset: bnb,
      calls: [
        { target: contractsWith(stackCurve)["curve"], input: "0x0902f1ac" },
        { target: contractsWith(stackCurve)["curve"], input: "0x808bcddc" },
      ],
    });
    // The curve's price is its quote reserve, the virtual 6 BNB among it, over its token reserve.
    expect(read.price([resultOf(reservesKey), resultOf(sellableKey)])).toStrictEqual({
      ok: true,
      value: {
        numerator: 6_001_239_083_940_651_678n,
        denominator: 999_793_528_649_113_901_752_606_722n,
      },
    });
  });

  it("asks for another read once the curve sells no more tokens", async () => {
    const read = readOf(await priceReadOf());
    const [readyKey, ready] = sellableAnswer(stackCurve, 0n);
    const answers = new Map([[readyKey, ready]]);
    expect(read.price([resultOf(reservesKey), resultOf(readyKey, answers)])).toStrictEqual({
      ok: false,
      error: "replan",
    });
  });

  it.each([
    ["no answer", [undefined, undefined]],
    ["one answer", ["0x01"]],
    ["answers outside their shape", ["0x01", "0x02"]],
  ])("prices nothing from %s", async (_case, answers) => {
    const read = readOf(await priceReadOf());
    expect(read.price(answers)).toStrictEqual({ ok: false, error: "unpriced" });
  });

  it("gives no read for a launch ready to graduate, so its token waits for its pool unpriced", async () => {
    const rpc = scriptedChain({ calls: new Map([sellableAnswer(stackCurve, 0n)]) });
    const request = { token: stackToken, contracts: contractsWith(stackCurve) };
    await expect(readCurvePrice(request, partsOver(rpc), live())).resolves.toStrictEqual({
      ok: false,
      error: "no_price_read",
    });
  });

  it("gives no read for a graduated token", async () => {
    await expect(priceReadOf(graduatedToken, registryContracts)).resolves.toStrictEqual({
      ok: false,
      error: "no_price_read",
    });
  });

  it("throws when the host's curve is not the token's own", async () => {
    await expect(priceReadOf(stackToken, contractsWith(olderCurve))).rejects.toMatchObject({
      code: "geniusfun.read_failed",
    });
  });
});
