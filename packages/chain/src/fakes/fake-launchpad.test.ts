import { bpsSchema, type Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { curveReaderContract } from "../contracts/curve-reader-contract.js";
import { insiderReaderContract } from "../contracts/insider-reader-contract.js";
import { priceReaderContract } from "../contracts/price-reader-contract.js";
import { quoterContract } from "../contracts/quoter-contract.js";
import type { PriceRead } from "../venues/price-read.js";
import { fakeCallOf } from "./fake-draft.js";
import { createFakeLaunchpad, fakePriceAnswer } from "./fake-launchpad.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000d");
const curve = accountRefSchema.parse("fake:1:0x0000000f");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const other = assetRefSchema.parse("fake:1/token:0x0000000e");
const contracts = { router };
const live = { signal: new AbortController().signal };

// The read a launchpad answered; a test that expects one fails on a refusal.
function readOf(result: Result<PriceRead, "no_price_read">): PriceRead {
  if (!result.ok) {
    throw new Error("The launchpad refused to price the token.");
  }
  return result.value;
}

describe("fake launchpad", () => {
  it.each(
    curveReaderContract({
      create: () => ({
        reader: createFakeLaunchpad({ onCurve: [token] }),
        onCurve: { token, contracts },
        offCurve: { token: other, contracts },
      }),
    }),
  )("follows the curve reader contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    curveReaderContract({
      create: () => ({
        reader: createFakeLaunchpad({ onCurve: [token], launchCurve: curve }),
        onCurve: { token, contracts },
        offCurve: { token: other, contracts },
      }),
    }),
  )("follows the curve reader contract with a launch curve: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    insiderReaderContract({
      create: () => ({
        reader: createFakeLaunchpad({ onCurve: [token], insiders: [wallet] }),
        launched: { token, contracts },
        other: { token: other, contracts },
      }),
    }),
  )("follows the insider reader contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("names its launch's curve for a held token, and trades and prices through it", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [token], launchCurve: curve });
    expect(launchpad.contracts).toStrictEqual([
      { chain: "fake:1", names: ["router"], launchContracts: ["curve"] },
    ]);
    await expect(launchpad.curve({ token, contracts }, live)).resolves.toStrictEqual({
      onCurve: true,
      quoteAsset: coin,
      launch: { curve },
    });
    const read = readOf(await launchpad.priceRead({ token, contracts: { curve } }, live));
    expect(read.calls).toStrictEqual([{ target: curve, input: `price:${token}` }]);
    const request = {
      wallet,
      amountIn: { asset: coin, base: 10n },
      assetOut: token,
      contracts: { router, curve },
      quote: { expectedOut: { asset: token, base: 20n }, priceImpactBps: bpsSchema.parse(10) },
      minOut: { asset: token, base: 19n },
      deadlineMs: 1_800_000_060_000,
    };
    const drafts = await launchpad.build(request, live);
    expect(drafts.map(fakeCallOf)).toMatchObject([{ to: "0x0000000f" }]);
    await expect(
      launchpad.build({ ...request, contracts: { router } }, live),
    ).rejects.toMatchObject({ code: "venue.no_contract" });
  });

  it.each(
    priceReaderContract({
      create: () => ({
        reader: createFakeLaunchpad({ onCurve: [token] }),
        priced: { token, contracts },
        answers: [fakePriceAnswer({ numerator: 3n, denominator: 2n })],
        unpriced: { token: other, contracts },
      }),
    }),
  )("follows the price reader contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices a curve token from its one answer and nothing else", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [token] });
    const read = readOf(await launchpad.priceRead({ token, contracts }, live));
    expect(read.calls).toStrictEqual([{ target: router, input: `price:${token}` }]);
    const price = { numerator: 7n, denominator: 5n };
    expect(read.price([fakePriceAnswer(price)])).toStrictEqual({ ok: true, value: price });
    const unpriced = { ok: false, error: "unpriced" };
    expect(read.price(["price:0/1"])).toStrictEqual(unpriced);
    expect(read.price(["price:1/1", "price:1/1"])).toStrictEqual(unpriced);
    launchpad.graduate(token);
    expect(await launchpad.priceRead({ token, contracts }, live)).toStrictEqual({
      ok: false,
      error: "no_price_read",
    });
  });

  it.each(
    quoterContract({
      create: () => ({
        quoter: createFakeLaunchpad({ onCurve: [token] }),
        request: { wallet, amountIn: { asset: coin, base: 1_000n }, assetOut: token, contracts },
        unroutable: { wallet, amountIn: { asset: coin, base: 1_000n }, assetOut: other, contracts },
      }),
    }),
  )("follows the quoter contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers a token that graduated as off its curve, and quotes it no more", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [token] });
    launchpad.graduate(token);
    expect(await launchpad.curve({ token, contracts }, live)).toStrictEqual({ onCurve: false });
    const request = { wallet, amountIn: { asset: token, base: 10n }, assetOut: coin, contracts };
    expect(await launchpad.quote(request, live)).toStrictEqual({ ok: false, error: "no_route" });
  });

  it("trades its tokens against the quote asset it names", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [token], quoteAsset: other, id: "pad" });
    expect(launchpad.id).toBe("pad");
    expect(await launchpad.curve({ token, contracts }, live)).toStrictEqual({
      onCurve: true,
      quoteAsset: other,
    });
    const request = { wallet, amountIn: { asset: other, base: 10n }, assetOut: token, contracts };
    expect(await launchpad.quote(request, live)).toMatchObject({ ok: true });
  });
});
