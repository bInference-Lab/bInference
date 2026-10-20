import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { IntentRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeRiskCheck } from "../fakes/fake-risk-check.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testCoin, testLimits, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { copiedHeldOf } from "./copy-state.js";
import { copyStateNow, copyTrade } from "./test-copies.js";
import {
  activeOrder,
  fillIntentsOf,
  fillPrices,
  fillRowsOf,
  noticesOf,
  startFillEngine,
} from "./test-fills.js";
import { testCopy } from "./test-orders.js";

const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");

// What a fill's intent asked, which must be stored.
function requestOf(intent: IntentRecord | undefined): IntentRequest {
  if (intent === undefined) {
    throw new Error("Expected the fill's intent.");
  }
  return requestDocument.decode(intent.request);
}
const tokenFacts = { symbol: "TKN", name: "Test token", decimals: 6, verified: true };

// A leader's buy of the test token, stored as trade `id`, made now.
function buyOf(id: number, atMs: number) {
  const paid = { asset: testCoin, base: 10n ** 17n };
  return {
    id,
    side: "buy" as const,
    asset: testToken,
    atMs,
    paid,
    facts: tokenFacts,
  };
}

// A leader's sale of the test token, stored as trade `id`, taking `shareBps` of its holding.
function saleOf(id: number, atMs: number, shareBps?: number) {
  const share = shareBps === undefined ? {} : { shareSoldBps: bpsSchema.parse(shareBps) };
  const sale = { id, side: "sell" as const, asset: testToken, atMs };
  return { ...sale, facts: tokenFacts, ...share };
}

function outcomes(rows: Awaited<ReturnType<typeof fillRowsOf>>) {
  return rows.map(({ outcome, reason }) =>
    reason === undefined ? outcome : `${outcome}:${reason}`,
  );
}

// The key of each notice's result or order part, oldest first.
function noticeParts(test: Parameters<typeof noticesOf>[0]) {
  return noticesOf(test).map((data) => JSON.stringify(data));
}

describe("a copy order's fills", () => {
  it("buys the leader's token at its dollars per buy and counts it in its state", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testCopy());

    expect(await copyTrade(test, order.id, buyOf(1, test.clock.now()))).toBe("filled");

    const [buy] = await fillIntentsOf(test);
    expect(requestOf(buy)).toMatchObject({ kind: "buy", token: testToken });
    expect(buy?.valueUsdMicros).toBeLessThanOrEqual(20_000_000n);
    const state = await copyStateNow(test, order.id);
    expect(state.buys).toStrictEqual([{ atMs: test.clock.now(), usdMicros: buy?.valueUsdMicros }]);
    expect(copiedHeldOf(state, testToken)).toBeGreaterThan(0n);
    expect(state).not.toHaveProperty("taking");
    expect(noticeParts(test).some((text) => text.includes('"fill.copyBuy"'))).toBe(true);
  });

  it("sells the leader's share of what the order bought, never the wallet's other tokens", async () => {
    // The fake venue pays two base units for one, so the token's price keeps the sale small.
    const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await copyTrade(test, order.id, buyOf(1, test.clock.now()));
    const bought = copiedHeldOf(await copyStateNow(test, order.id), testToken);

    expect(await copyTrade(test, order.id, saleOf(2, test.clock.now(), 4_000))).toBe("filled");

    const sale = (await fillIntentsOf(test)).find(({ kind }) => kind === "sell");
    expect(requestOf(sale)).toMatchObject({
      kind: "sell",
      amount: { base: (bought * 4_000n) / 10_000n },
    });
    const left = copiedHeldOf(await copyStateNow(test, order.id), testToken);
    expect(left).toBe(bought - (bought * 4_000n) / 10_000n);
    expect(noticeParts(test).some((text) => text.includes('"fill.copySell"'))).toBe(true);
  });

  it("skips a sale whose share the watcher could not read, and a trade past its minute", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testCopy());
    await copyTrade(test, order.id, buyOf(1, test.clock.now()));

    expect(await copyTrade(test, order.id, saleOf(2, test.clock.now()))).toBe("skipped");
    const late = test.clock.now() - 60_001;
    expect(await copyTrade(test, order.id, buyOf(3, late))).toBe("skipped");

    const rows = await fillRowsOf(test, order.id);
    expect(outcomes(rows)).toStrictEqual(["skipped:late", "skipped:share_unread", "filled"]);
    expect(await fillIntentsOf(test)).toHaveLength(1);
    const told = noticeParts(test).filter((text) => text.includes('"fill.copyTrade"'));
    expect(told).toHaveLength(2);
    expect(told[0]).toContain('"token":"TKN"');
  });

  it("skips a buy past its daily dollars, telling what was used of the cap", async () => {
    const test = await startFillEngine();
    const daily = { ...testCopy().trigger, dailyUsdMicros: 40_000_000n };
    const order = await activeOrder(test, testCopy({ trigger: daily }));

    await copyTrade(test, order.id, buyOf(1, test.clock.now()));
    await copyTrade(test, order.id, buyOf(2, test.clock.now()));
    expect(await copyTrade(test, order.id, buyOf(3, test.clock.now()))).toBe("skipped");

    const rows = await fillRowsOf(test, order.id);
    expect(outcomes(rows)[0]).toBe("skipped:copy_daily_cap");
    expect(noticeParts(test).at(-1)).toContain('"cap":"$40.00"');
  });

  it("spends no more than the agent's own dollars per buy when they are lower", async () => {
    const test = await startFillEngine({
      agent: { limits: { ...testLimits, copyPerBuyUsdMicros: 5_000_000n } },
    });
    const order = await activeOrder(test, testCopy());

    expect(await copyTrade(test, order.id, buyOf(1, test.clock.now()))).toBe("filled");

    const [buy] = await fillIntentsOf(test);
    expect(buy?.valueUsdMicros).toBeLessThanOrEqual(5_000_000n);
  });

  it("skips a leader's buy of a honeypot and names the token in the notice", async () => {
    const clock = createManualClock(testNowMs);
    const risk = createFakeRiskCheck({ chains: testChains(), clock, refusal: "honeypot" });
    const test = await startFillEngine({ risk });
    const order = await activeOrder(test, testCopy());
    const facts = { symbol: "HONEY", name: "Honey", decimals: 18, verified: false };
    const atMs = test.clock.now();
    const paid = { asset: testCoin, base: 10n ** 17n };
    const honey = {
      id: 1,
      side: "buy" as const,
      asset: unlisted,
      atMs,
      paid,
      facts,
    };

    expect(await copyTrade(test, order.id, honey)).toBe("skipped");

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:honeypot"]);
    const told = noticeParts(test).find((text) => text.includes('"reason.honeypot"'));
    expect(told).toContain('"token":"HONEY 0x0000000f"');
    expect(copiedHeldOf(await copyStateNow(test, order.id), unlisted)).toBe(0n);
  });
});
