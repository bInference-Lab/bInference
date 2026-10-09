import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createVenueHost, type VenueTrade } from "@binference/engine";
import {
  bnb,
  buyQuoteAnswer,
  buyRoute,
  buySwapAnswer,
  okxApprover,
  quotedAtMs,
  quoteUrlOf,
  scriptedApi,
  sellQuoteAnswer,
  sellRoute,
  sellSwapAnswer,
  swapUrlOf,
  usdt,
  venueOver,
  wallet,
} from "@binference/okx/testing";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "./open-engine-parts.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function hostOver() {
  const http = scriptedApi({
    [quoteUrlOf(buyRoute)]: buyQuoteAnswer,
    [swapUrlOf(buyRoute)]: buySwapAnswer,
    [quoteUrlOf(sellRoute)]: sellQuoteAnswer,
    [swapUrlOf(sellRoute)]: sellSwapAnswer,
  });
  return createVenueHost({
    venues: [venueOver(http)],
    chains: selfHostedChains(),
    clock: createManualClock(quotedAtMs),
    callTimeoutMs: 5_000,
  });
}

function tradeOf(amountIn: VenueTrade["amountIn"], assetOut: VenueTrade["assetOut"]): VenueTrade {
  return { venue: "okx", wallet, amountIn, assetOut, maxSlippageBps: bpsSchema.parse(50) };
}

describe("the okx venue in the self-hosted venue host", () => {
  it("passes every build-step check on a coin buy, at the host's minimum and deadline", async () => {
    const trade = tradeOf({ asset: bnb, base: 10n ** 17n }, usdt);
    await expect(hostOver().plan(trade, live())).resolves.toMatchObject({
      ok: true,
      value: {
        venue: "okx",
        terms: { quotedAtMs, minOutBase: 73_829_000_000_000_000_000n },
        steps: [{ kind: "trade", effect: { recipient: wallet, deadlineMs: quotedAtMs + 60_000 } }],
      },
    });
  });

  it("passes every build-step check on a token sale, approving OKX's TokenApprove", async () => {
    const trade = tradeOf({ asset: usdt, base: 50n * 10n ** 18n }, bnb);
    await expect(hostOver().plan(trade, live())).resolves.toMatchObject({
      ok: true,
      value: {
        steps: [
          {
            kind: "approval",
            approval: {
              asset: usdt,
              spender: `eip155:56:${okxApprover}`,
              amountBase: 50n * 10n ** 18n,
            },
          },
          { kind: "trade", effect: { amountIn: { asset: usdt, base: 50n * 10n ** 18n } } },
        ],
      },
    });
  });
});
