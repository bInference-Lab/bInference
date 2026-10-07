import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createVenueHost, type VenueTrade } from "@binference/engine";
import {
  answer,
  bnb,
  buildUrl,
  buyBuild,
  buyRoute,
  buyRoutesUrl,
  recordedDeadlineSec,
  recordedWallet,
  scriptedApi,
  sellBuild,
  sellRoute,
  sellRoutesUrl,
  usdt,
  venueOver,
} from "@binference/kyberswap/testing";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "./open-engine-parts.js";

// The host's deadline is its quote time plus 60 s: the recorded builds' deadline, to the second.
const quotedAtMs = recordedDeadlineSec * 1000 - 60_000;
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function hostOver(routesUrl: string, route: string, build: string) {
  const http = scriptedApi({ [routesUrl]: answer(route), [buildUrl]: answer(build) });
  return createVenueHost({
    venues: [venueOver(http)],
    chains: selfHostedChains(),
    clock: createManualClock(quotedAtMs),
    callTimeoutMs: 5_000,
  });
}

function tradeOf(amountIn: VenueTrade["amountIn"], assetOut: VenueTrade["assetOut"]): VenueTrade {
  return {
    venue: "kyberswap",
    wallet: recordedWallet,
    amountIn,
    assetOut,
    maxSlippageBps: bpsSchema.parse(50),
  };
}

describe("the kyberswap venue in the self-hosted venue host", () => {
  it("passes every build-step check on KyberSwap's recorded coin buy", async () => {
    const host = hostOver(buyRoutesUrl, buyRoute, buyBuild);
    const trade = tradeOf({ asset: bnb, base: 10n ** 17n }, usdt);
    await expect(host.plan(trade, live())).resolves.toMatchObject({
      ok: true,
      value: {
        venue: "kyberswap",
        terms: { quotedAtMs, minOutBase: 76_321_695_368_036_993_741n },
        steps: [{ kind: "trade", effect: { recipient: recordedWallet } }],
      },
    });
  });

  it("passes every build-step check on KyberSwap's recorded token sale", async () => {
    const host = hostOver(sellRoutesUrl, sellRoute, sellBuild);
    const trade = tradeOf({ asset: usdt, base: 50n * 10n ** 18n }, bnb);
    await expect(host.plan(trade, live())).resolves.toMatchObject({
      ok: true,
      value: {
        steps: [
          { kind: "approval", approval: { asset: usdt, amountBase: 50n * 10n ** 18n } },
          { kind: "trade", effect: { amountIn: { asset: usdt, base: 50n * 10n ** 18n } } },
        ],
      },
    });
  });
});
