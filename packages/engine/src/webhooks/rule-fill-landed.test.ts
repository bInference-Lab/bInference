import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { landedRuleFillWrite } from "./rule-fill-landed.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

const live = { signal: new AbortController().signal };

// A live buy rule of the test token at its second fill of three.
const rule = {
  id: fixtureId("whr", 1),
  agentId: testAgent,
  intentId: fixtureId("int", 1),
  isPaper: false,
  state: "active",
  fills: 1,
  maxFills: 3,
  request: { token: testToken, side: "buy", name: "BNB breakout" },
  version: 4,
} as unknown as WebhookRuleRecord;

const settled = {
  amountIn: { asset: testCoin, base: 10n ** 15n },
  amountOut: { asset: testToken, base: 10n ** 18n },
};

// The fill intent and its quote, which prices nothing the price source does not.
const quote = quoteDocument.encode({
  route: [{ venue: "fake", shareBps: bpsSchema.parse(10_000) }],
  amountIn: settled.amountIn,
  expectedOut: settled.amountOut,
  minOut: settled.amountOut,
  priceImpactBps: bpsSchema.parse(0),
  gas: { asset: testCoin, base: 0n },
  quotedAt: testNowMs,
  expiresAt: testNowMs,
});
const snapshot = {
  record: { id: fixtureId("int", 7), agentId: testAgent, quote },
} as unknown as IntentSnapshot;

// The write of the fill landing on `landed`, with no USD price for its notice.
async function writeOn(landed: WebhookRuleRecord) {
  const parts = {
    intents: { get: async () => Promise.resolve(undefined) },
    prices: createFakePriceSource(new Map()),
    chains: testChains(),
  };
  const call = { rule: landed, event: 9, snapshot, settled, atMs: testNowMs, ...live };
  return landedRuleFillWrite(parts, call);
}

describe("a landed live rule fill's write on its alert", () => {
  it("counts the fill on its rule, ending the rule with its last fill", async () => {
    const second = await writeOn(rule);
    const last = await writeOn({ ...rule, fills: 2 });

    expect(second).toStrictEqual({
      event: 9,
      outcome: "filled",
      intentId: snapshot.record.id,
      move: { id: rule.id, expectedVersion: 4, state: "active", atMs: testNowMs, fills: 2 },
    });
    expect(last.move).toMatchObject({ state: "deleted", fills: 3 });
  });

  it("counts a fill of a rule deleted meanwhile without moving it, and alarms past its most fills", async () => {
    const deleted = await writeOn({ ...rule, state: "deleted" });
    const over = await writeOn({ ...rule, state: "deleted", fills: 3 });

    expect(deleted).toStrictEqual({ event: 9, outcome: "filled", intentId: snapshot.record.id });
    expect(over.move).toBeUndefined();
    expect(over.notices).toMatchObject([
      {
        key: "notice.orderOverfilled",
        values: { fills: "4", maxFills: "3" },
        parts: { orderKind: { key: "fill.webhookRule", values: { name: "BNB breakout" } } },
      },
    ]);
  });
});
