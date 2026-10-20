import { assetRefSchema } from "@binference/chain";
import { bpsSchema, idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { agentSettingsOf } from "../agents/agent-record.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testLimits,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { type CopyOrder, planCopyFill } from "./copy-fills.js";
import {
  copyGraceMs,
  copyStartOf,
  copyStateAfterFill,
  copyStateDocument,
  type CopyState,
  type CopyTaking,
  takenState,
} from "./copy-state.js";
import { testLeaderTx } from "./test-copies.js";
import { testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const listedFacts = { symbol: "TKN", name: "Test token", decimals: 6, verified: true };
const buy: Omit<CopyTaking, "take"> = {
  id: 1,
  txHash: testLeaderTx,
  side: "buy",
  asset: testToken,
  atMs: testNowMs,
  // A tenth of the coin, $60 at the coin's $600.
  paid: { asset: testCoin, base: 10n ** 17n },
  facts: listedFacts,
};

function copyOrder(state: CopyState, n = 1): CopyOrder {
  return {
    id: idSchema("ord").parse(`ord_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`),
    agentId: testAgent,
    walletId: testWallet,
    kind: "copy",
    state: "active",
    request: testCopy(),
    expiresAtMs: testNowMs + 1_000_000,
    intentId: idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    isPaper: true,
    hasOutsideContent: false,
    triggerState: copyStateDocument.encode(state),
    fills: 0,
    createdAtMs: 0,
    changedAtMs: 0,
    version: 1,
  };
}

// A buy of `usdMicros` the order's state counted, at the test time.
function boughtFor(state: CopyState, usdMicros: bigint): CopyState {
  const traded = {
    side: "buy" as const,
    amountIn: { asset: testCoin, base: 1n },
    amountOut: { asset: testToken, base: 1n },
    usdMicros,
    atMs: testNowMs,
  };
  return copyStateAfterFill(state, traded);
}

async function plan(
  order: CopyOrder,
  call: { readonly stored?: readonly bigint[]; readonly copyPerBuy?: bigint } = {},
) {
  const clock = createManualClock(testNowMs);
  const limits = { ...testLimits, copyPerBuyUsdMicros: call.copyPerBuy ?? 20_000_000n };
  const settings = agentSettingsOf(testAgentDraft({ limits }));
  // The agent's stored copy buys of the leader, by any of its copy orders.
  const buys = (call.stored ?? []).map((usdMicros, n) => ({
    id: idSchema("fil").parse(`fil_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`),
    atMs: testNowMs,
    usdMicros,
  }));
  const orders = { copyBuys: async () => Promise.resolve(buys) };
  const prices = createFakePriceSource(
    new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]),
  );
  return planCopyFill(
    { orders, chains: testChains(), prices, clock },
    { order, settings, ...live },
  );
}

describe("a copy order's fill plan", () => {
  it("buys the leader's token at the order's dollars, or the agent's when lower", async () => {
    const order = copyOrder(takenState(copyStartOf(0), buy));

    expect(await plan(order)).toMatchObject({
      kind: "fill",
      order: { request: { token: testToken, side: "buy", size: { usdMicros: 20_000_000n } } },
      price: { decimals: 6 },
    });
    expect(await plan(order, { copyPerBuy: 5_000_000n })).toMatchObject({
      order: { request: { size: { usdMicros: 5_000_000n } } },
    });
  });

  it("buys no more than the leader's own buy, and skips one nothing values", async () => {
    const small = { ...buy, paid: { asset: testCoin, base: 10n ** 16n } };
    const unpriced = { ...buy, paid: { asset: unlisted, base: 10n ** 16n } };
    const { paid: _paid, ...unpaid } = buy;

    expect(await plan(copyOrder(takenState(copyStartOf(0), small)))).toMatchObject({
      order: { request: { size: { usdMicros: 6_000_000n } } },
    });
    expect(await plan(copyOrder(takenState(copyStartOf(0), unpriced)))).toStrictEqual({
      kind: "skip",
      reason: "leader_unpriced",
    });
    expect(await plan(copyOrder(takenState(copyStartOf(0), unpaid)))).toStrictEqual({
      kind: "skip",
      reason: "leader_unpriced",
    });
  });

  it("skips a buy under $5, and the eleventh buy of an hour", async () => {
    const dust = { ...buy, paid: { asset: testCoin, base: 10n ** 15n } };
    const busy = Array.from({ length: 10 }, () => 0).reduce(
      (state) => boughtFor(state, 20_000_000n),
      copyStartOf(0),
    );

    expect(await plan(copyOrder(takenState(copyStartOf(0), dust)))).toStrictEqual({
      kind: "skip",
      reason: "copy_too_small",
    });
    expect(await plan(copyOrder(takenState(busy, buy)))).toStrictEqual({
      kind: "skip",
      reason: "copy_hourly",
    });
  });

  it("sells the leader's share however late, and skips a sale whose share is unknown", async () => {
    const sale = { ...buy, side: "sell" as const, shareSoldBps: bpsSchema.parse(4_000) };
    const { shareSoldBps: _share, ...unshared } = sale;

    expect(await plan(copyOrder(takenState(copyStartOf(0), sale)))).toMatchObject({
      kind: "fill",
      order: { request: { side: "sell", size: { percentBps: 4_000 } } },
    });
    const late = { ...sale, atMs: testNowMs - copyGraceMs - 1 };
    expect(await plan(copyOrder(takenState(copyStartOf(0), late)))).toMatchObject({
      kind: "fill",
    });
    expect(await plan(copyOrder(takenState(copyStartOf(0), unshared)))).toStrictEqual({
      kind: "skip",
      reason: "share_unread",
    });
  });

  it("skips a buy past its minute, and a trade whose token has no decimals", async () => {
    const late = { ...buy, atMs: testNowMs - copyGraceMs - 1 };
    const { facts: _facts, ...unread } = { ...buy, asset: unlisted };

    expect(await plan(copyOrder(takenState(copyStartOf(0), late)))).toStrictEqual({
      kind: "skip",
      reason: "late",
    });
    expect(await plan(copyOrder(takenState(copyStartOf(0), unread)))).toStrictEqual({
      kind: "skip",
      reason: "token_unreadable",
    });
    expect(await plan(copyOrder(copyStartOf(0)))).toStrictEqual({ kind: "none" });
  });

  it("skips a buy past the order's daily dollars, then past the agent's for the leader", async () => {
    const full = boughtFor(copyStartOf(0), 190_000_000n);
    // The test agent allows $100 a day per leader; its copy orders of the leader stored $90.
    const some = boughtFor(copyStartOf(0), 60_000_000n);

    expect(await plan(copyOrder(takenState(full, buy)))).toStrictEqual({
      kind: "skip",
      reason: "copy_daily_cap",
      cap: { usedUsdMicros: 190_000_000n, capUsdMicros: 200_000_000n },
    });
    const stored = [60_000_000n, 30_000_000n];
    expect(await plan(copyOrder(takenState(some, buy)), { stored })).toStrictEqual({
      kind: "skip",
      reason: "copy_daily_cap",
      cap: { usedUsdMicros: 90_000_000n, capUsdMicros: 100_000_000n },
    });
    expect(await plan(copyOrder(takenState(some, buy)), { stored: [60_000_000n] })).toMatchObject({
      kind: "fill",
    });
  });
});
