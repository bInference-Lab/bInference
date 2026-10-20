import {
  accountRefSchema,
  chainRefSchema,
  type TokenRiskReport,
  type TxSimulator,
} from "@binference/chain";
import { createFakeRiskSource } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createLaunchHost, createVenueHost, type VenueTrade } from "@binference/engine";
import { createRiskCheck } from "@binference/engine/risk";
import { createMemoryRiskCacheStore } from "@binference/engine/testing";
import { createGeniusfunVenue } from "@binference/geniusfun";
import {
  bnb,
  graduatedToken,
  type RecordedCall,
  recordedWallet,
  scriptedChain,
  snipeTaxAnswer,
  stackCreator,
  stackCurve,
  stackToken,
  venueOver,
} from "@binference/geniusfun/testing";
import { successOf } from "@binference/plugin-sdk/testing";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "./open-engine-parts.js";

const curveAccount = accountRefSchema.parse(`eip155:56:${stackCurve}`);
const bsc = chainRefSchema.parse("eip155:56");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const nowMs = 1_800_000_000_000;

function hostOver(calls: readonly (readonly [string, RecordedCall])[] = []) {
  return createVenueHost({
    venues: [venueOver(scriptedChain({ calls: new Map(calls) }))],
    chains: selfHostedChains(),
    clock: createManualClock(nowMs),
    callTimeoutMs: 5_000,
  });
}

function tradeOf(amountIn: VenueTrade["amountIn"], assetOut: VenueTrade["assetOut"]): VenueTrade {
  return {
    venue: "geniusfun",
    wallet: recordedWallet,
    amountIn,
    assetOut,
    maxSlippageBps: bpsSchema.parse(100),
  };
}

// A simulator whose node is down: the round trip is unavailable, so only the quote decides.
const unreachable: TxSimulator = {
  simulate: async () => await Promise.reject(new Error("The node is down.")),
};

describe("the geniusfun launchpad in the self-hosted venue host", () => {
  it("passes every build-step check on a recorded BNB buy on the launch's curve, with no deadline", async () => {
    const trade = tradeOf({ asset: bnb, base: parseEther("0.1") }, stackToken);
    const plan = await hostOver().plan(trade, live());
    expect(plan).toMatchObject({
      ok: true,
      value: {
        venue: "geniusfun",
        steps: [{ kind: "trade", effect: { recipient: recordedWallet } }],
      },
    });
    expect(plan).not.toHaveProperty("value.quote.taxBps");
    expect(plan).not.toHaveProperty("value.steps.0.effect.deadlineMs");
  });

  it("passes every build-step check on a recorded sale, after an exact approval of the curve", async () => {
    const amountIn = { asset: stackToken, base: parseEther("1000000") };
    await expect(hostOver().plan(tradeOf(amountIn, bnb), live())).resolves.toMatchObject({
      ok: true,
      value: {
        steps: [
          { kind: "approval", approval: { asset: stackToken, amountBase: amountIn.base } },
          { kind: "trade", effect: { amountIn } },
        ],
      },
    });
  });

  it("finds a token on its launch's curve, and a graduated one nowhere", async () => {
    const host = hostOver();
    await expect(host.curves(stackToken, live())).resolves.toStrictEqual({
      ok: true,
      value: [{ launchpad: "geniusfun", quoteAsset: bnb, launch: { curve: curveAccount } }],
    });
    await expect(host.curves(graduatedToken, live())).resolves.toStrictEqual({
      ok: true,
      value: [],
    });
  });

  it("refuses a buy in the launch window whose snipe tax tops the maximum, naming the creator's exempt wallet", async () => {
    const host = hostOver([snipeTaxAnswer(stackCurve, 9_900n)]);
    const trade = tradeOf({ asset: bnb, base: parseEther("0.1") }, stackToken);
    const quoted = successOf(await host.quote(trade, live()));
    const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 10n ** 15n };
    const check = createRiskCheck({
      sources: [
        {
          source: createFakeRiskSource({ id: "goplus", reports: new Map([[stackToken, deep]]) }),
          isRequired: true,
        },
      ],
      cache: createMemoryRiskCacheStore(["goplus"]),
      cacheTtlMs: () => 600_000,
      sourceTimeoutMs: 5_000,
      host,
      simulator: unreachable,
      chains: selfHostedChains(),
      clock: createManualClock(nowMs),
      random: createSeededRandom(25),
    });
    const limits = { maxTaxBps: bpsSchema.parse(1_000), liquidityFloorUsdMicros: 10_000_000_000n };
    const assessment = await check.assess({ quoted, limits }, live());
    expect(quoted.quote).toMatchObject({ taxBps: 9_700, snipeTaxBps: 9_700 });
    expect(assessment).toMatchObject({
      refusal: "snipe_tax",
      view: { verdict: "block", insiders: [stackCreator] },
    });
  });

  it("is hosted as a launchpad on BSC that takes a link for its picture and two settings", () => {
    const venue = createGeniusfunVenue({
      chains: [{ chain: bsc, nativeAsset: bnb, quoteTokens: [], rpc: scriptedChain() }],
      launches: {
        random: createSeededRandom(277),
        chains: [{ chain: bsc, simulator: unreachable }],
      },
    });
    const host = createLaunchHost({
      venues: [venue],
      chains: selfHostedChains(),
      clock: createManualClock(nowMs),
      callTimeoutMs: 5_000,
    });
    const given = {
      creatorFeeRecipient: "0x00000000000000000000000000000000000000AA",
      pictureLink: "ipfs://bafkreig7wwicvvvzrbrcgs62ybg7yc7f7ay6s6yhsgpxcxvan5owbcfefm",
    };
    expect(host.settingsOf("geniusfun", bsc, given)).toMatchObject({ ok: true });
    expect(host.settingsOf("geniusfun", bsc, { pictureLink: given.pictureLink })).toStrictEqual({
      ok: false,
      error: "bad_settings",
    });
    expect(host.picturePlace("geniusfun")).toBe("link");
    // Its two create calls, and its curves' buy and sell, are a launch wallet's ceiling's to allow;
    // the overloads it never builds are not.
    const names = host.launchWalletCalls("geniusfun").map((abi) => JSON.stringify(abi));
    expect(names.map((abi) => /"name":"(\w+)"/u.exec(abi)?.[1])).toStrictEqual([
      "launchAndBuy",
      "launchToken",
      "buy",
      "sell",
    ]);
  });
});
