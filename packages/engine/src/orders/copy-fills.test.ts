import { assetRefSchema } from "@binference/chain";
import { bpsSchema, idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { agentSettingsOf } from "../agents/agent-record.js";
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
import type { OrderRecord } from "./order-record.js";
import { testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const listedFacts = { symbol: "TKN", name: "Test token", decimals: 6, verified: true };
const buy: CopyTaking = {
  id: 1,
  side: "buy",
  asset: testToken,
  atMs: testNowMs,
  takenAtMs: 0,
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
    takenAtMs: 0,
  };
  return copyStateAfterFill(state, traded);
}

async function plan(
  order: CopyOrder,
  call: { readonly others?: readonly OrderRecord[]; readonly copyPerBuy?: bigint } = {},
) {
  const clock = createManualClock(testNowMs);
  const limits = { ...testLimits, copyPerBuyUsdMicros: call.copyPerBuy ?? 20_000_000n };
  const settings = agentSettingsOf(testAgentDraft({ limits }));
  const orders = { list: async () => Promise.resolve([order, ...(call.others ?? [])]) };
  return planCopyFill({ orders, chains: testChains(), clock }, { order, settings, ...live });
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
    // The test agent allows $100 a day per leader; its other copy order of the leader used $30.
    const some = boughtFor(copyStartOf(0), 60_000_000n);
    const other = copyOrder(boughtFor(copyStartOf(0), 30_000_000n), 2);

    expect(await plan(copyOrder(takenState(full, buy)))).toStrictEqual({
      kind: "skip",
      reason: "copy_daily_cap",
      cap: { usedUsdMicros: 190_000_000n, capUsdMicros: 200_000_000n },
    });
    expect(await plan(copyOrder(takenState(some, buy)), { others: [other] })).toStrictEqual({
      kind: "skip",
      reason: "copy_daily_cap",
      cap: { usedUsdMicros: 90_000_000n, capUsdMicros: 100_000_000n },
    });
    expect(await plan(copyOrder(takenState(some, buy)))).toMatchObject({ kind: "fill" });
  });
});
