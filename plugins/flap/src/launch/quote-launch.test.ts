import { assetRefSchema } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  dryRunSimulator,
  launchPartsOver,
  recordedFirstBuyOut,
  testLaunch,
} from "../testing/launch-fixtures.js";
import { bnb, bscChain } from "../testing/portal-fixtures.js";
import { quoteLaunch } from "./quote-launch.js";

const { signal } = new AbortController();

describe("a Flap launch's quote", () => {
  it("runs its create call dry and reads the first buy, with no launch fee", async () => {
    const simulator = dryRunSimulator();
    const parts = launchPartsOver(undefined, simulator);
    await expect(quoteLaunch(testLaunch, parts, signal)).resolves.toStrictEqual({
      ok: true,
      value: { fee: { asset: bnb, base: 0n }, tokenDecimals: 18, firstBuyOut: recordedFirstBuyOut },
    });
    expect(simulator.runs()).toBe(1);
  });

  it.each([
    { buyTaxBps: 0, sellTaxBps: 0 },
    { buyTaxBps: 50, sellTaxBps: 300 },
  ])("refuses taxes of $buyTaxBps and $sellTaxBps before any dry run", async (tax) => {
    const simulator = dryRunSimulator();
    const parts = launchPartsOver(undefined, simulator);
    const terms = { ...testLaunch, options: { ...testLaunch.options, ...tax } };
    await expect(quoteLaunch(terms, parts, signal)).rejects.toMatchObject({
      code: "flap.bad_settings",
    });
    expect(simulator.runs()).toBe(0);
  });

  it("answers a pair Flap does not launch against as no route", async () => {
    const wbnb = assetRefSchema.parse(
      `${bscChain}/erc20:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`,
    );
    const terms = { ...testLaunch, pair: wbnb, firstBuy: { asset: wbnb, base: 1n } };
    await expect(quoteLaunch(terms, launchPartsOver(), signal)).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });
});
