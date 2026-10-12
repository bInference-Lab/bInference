import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createVenueHost, type VenueTrade } from "@binference/engine";
import {
  bnb,
  graduatedToken,
  recordedWallet,
  scriptedPortal,
  taxToken,
  usdt,
  usdtToken,
  venueOver,
} from "@binference/flap/testing";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "./open-engine-parts.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function hostOverPortal() {
  return createVenueHost({
    venues: [venueOver(scriptedPortal())],
    chains: selfHostedChains(),
    clock: createManualClock(1_800_000_000_000),
    callTimeoutMs: 5_000,
  });
}

function tradeOf(amountIn: VenueTrade["amountIn"], assetOut: VenueTrade["assetOut"]): VenueTrade {
  return {
    venue: "flap",
    wallet: recordedWallet,
    amountIn,
    assetOut,
    maxSlippageBps: bpsSchema.parse(100),
  };
}

describe("the flap launchpad in the self-hosted venue host", () => {
  it("passes every build-step check on a recorded BNB buy, with no deadline", async () => {
    const trade = tradeOf({ asset: bnb, base: 10n ** 17n }, taxToken);
    const plan = await hostOverPortal().plan(trade, live());
    expect(plan).toMatchObject({
      ok: true,
      value: {
        venue: "flap",
        quote: { taxBps: 300 },
        steps: [{ kind: "trade", effect: { recipient: recordedWallet } }],
      },
    });
    expect(plan).not.toHaveProperty("value.steps.0.effect.deadlineMs");
  });

  it("passes every build-step check on a recorded USDT curve sale, after an exact approval", async () => {
    const amountIn = { asset: usdtToken, base: 100_000n * 10n ** 18n };
    await expect(hostOverPortal().plan(tradeOf(amountIn, usdt), live())).resolves.toMatchObject({
      ok: true,
      value: {
        steps: [
          { kind: "approval", approval: { asset: usdtToken, amountBase: amountIn.base } },
          { kind: "trade", effect: { amountIn } },
        ],
      },
    });
  });

  it("finds a curve token on Flap's curve, and a graduated one nowhere", async () => {
    const host = hostOverPortal();
    await expect(host.curves(taxToken, live())).resolves.toStrictEqual({
      ok: true,
      value: [{ launchpad: "flap", quoteAsset: bnb }],
    });
    await expect(host.curves(graduatedToken, live())).resolves.toStrictEqual({
      ok: true,
      value: [],
    });
  });
});
