import { type AssetRef, assetRefSchema, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { type Bps, bpsSchema, err } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { checkOrderRequest } from "./order-rules.js";

const verification = {
  source: "https://example.invalid/fake-chain",
  checkedOn: "2026-01-01",
  control: "read",
} as const;

// The fake chain with a stablecoin beside its token, and a second chain of the same family.
function chainsWithStable() {
  const fake = createFakeChainDefinition();
  const stable = { symbol: "USDF", name: "Fake Dollar", decimals: 18, address: "0x000000aa" };
  return createChainRegistry({
    chains: [
      { ...fake, tokens: [...fake.tokens, { ...stable, verification }] },
      { ...fake, id: "fake:2", key: "fake-two", name: "Fake Two", tokens: [] },
    ],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

const stable: AssetRef = assetRefSchema.parse("fake:1/token:0x000000aa");
const otherChainCoin: AssetRef = assetRefSchema.parse("fake:2/slip44:1");

function limitBuy(changes: Partial<OrderRequest>): OrderRequest {
  return {
    kind: "limit",
    agent: testAgent,
    token: testToken,
    side: "buy",
    size: { usdMicros: 25_000_000n },
    trigger: { price: 500_000n, direction: "below" },
    ...changes,
  } as OrderRequest;
}

function check(request: OrderRequest) {
  return checkOrderRequest(request, { nowMs: testNowMs, chains: chainsWithStable() });
}

describe("a buy order's size and what it spends", () => {
  it("spends the chain's coin when the request names nothing to spend", () => {
    expect(check(limitBuy({}))).toMatchObject({
      ok: true,
      value: { request: { spend: testCoin, size: { usdMicros: 25_000_000n } } },
    });
  });

  it("takes a size in the spent asset's base units or as a share of what it may spend", () => {
    const byBase = check(limitBuy({ spend: stable, size: { base: 10n ** 20n } }));
    const byShare = check(limitBuy({ size: { percentBps: bpsSchema.parse(2_500) } }));
    expect(byBase).toMatchObject({
      ok: true,
      value: { request: { spend: stable, size: { base: 10n ** 20n } } },
    });
    expect(byShare).toMatchObject({
      ok: true,
      value: { request: { spend: testCoin, size: { percentBps: 2_500 } } },
    });
  });

  it.each([
    ["a share above 100%", { size: { percentBps: 10_001 as Bps } }],
    ["a share of zero", { size: { percentBps: bpsSchema.parse(0) } }],
    ["zero base units", { size: { base: 0n } }],
    ["the token it buys as what it spends", { spend: testToken }],
    ["an asset the registry does not list", { spend: assetRefSchema.parse("fake:1/token:0x0f") }],
    ["another chain's coin", { spend: otherChainCoin }],
    ["what a sale spends", { side: "sell", spend: testCoin }],
  ] as const)("refuses %s", (_name, changes) => {
    expect(check(limitBuy(changes))).toStrictEqual(err("protocol.bad_args"));
  });
});

function inShanghai(request: OrderRequest) {
  const context = { nowMs: testNowMs, chains: chainsWithStable(), ownerZone: "Asia/Shanghai" };
  return checkOrderRequest(request, context);
}

describe("a DCA order", () => {
  const dca = {
    kind: "dca",
    agent: testAgent,
    token: testToken,
    side: "buy",
    size: { usdMicros: 10_000_000n },
    trigger: { cron: "0 9 * * 1-5" },
  } as const;
  it("runs on the owner's zone unless it names one, and buys its count of times", () => {
    expect(inShanghai(dca)).toMatchObject({
      ok: true,
      value: { request: { spend: testCoin, trigger: { timezone: "Asia/Shanghai" } } },
    });
    expect(inShanghai(dca)).not.toHaveProperty("value.maxFills");
    const counted = { ...dca, trigger: { cron: "0 9 * * *", timezone: "UTC", count: 5 } };
    expect(inShanghai(counted)).toMatchObject({
      ok: true,
      value: { maxFills: 5, request: { maxFills: 5, trigger: { timezone: "UTC", count: 5 } } },
    });
  });

  it("refuses a sale, a count its fills disagree with, and a period it cannot read", () => {
    const counted = { ...dca, trigger: { ...dca.trigger, count: 5 } };
    expect(inShanghai({ ...dca, side: "sell" })).toStrictEqual(err("protocol.bad_args"));
    expect(inShanghai({ ...counted, maxFills: 4 })).toStrictEqual(err("protocol.bad_args"));
    expect(inShanghai({ ...dca, trigger: { cron: "0 9 31 2 *" } })).toStrictEqual(
      err("schedule.bad_when"),
    );
    expect(
      inShanghai({ ...dca, trigger: { cron: "0 9 * * *", timezone: "Mars/Base" } }),
    ).toStrictEqual(err("schedule.bad_when"));
  });
});
