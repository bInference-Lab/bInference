import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { assetsDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { landedRuleFillWrite } from "./rule-fill-landed.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

const live = { signal: new AbortController().signal };
// $600 a whole coin of 18 decimals.
const coinPrice = { numerator: 600n, denominator: 10n ** 18n };
// A token the test registry does not list, which a rule's card stored as its proposal read it.
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const unlistedInfo = { symbol: "XVS", name: "Venus", decimals: 18, verified: false };

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

// The write of the fill landing on `landed`, with no USD price for its notice unless given, and
// the rule's card storing `cardAssets` of the tokens the registry lacks.
async function writeOn(
  landed: WebhookRuleRecord,
  given: { readonly coinPrice?: boolean; readonly cardAssets?: AssetInfos } = {},
) {
  const { cardAssets } = given;
  const card = cardAssets === undefined ? undefined : { assets: assetsDocument.encode(cardAssets) };
  const prices = new Map(given.coinPrice === true ? [[testCoin, coinPrice] as const] : []);
  const parts = {
    intents: { get: async () => Promise.resolve(card as IntentRecord | undefined) },
    prices: createFakePriceSource(prices),
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

  it("tells the owner the fill, priced, of a token the registry lists", async () => {
    const write = await writeOn(rule, { coinPrice: true });
    expect(write.notices).toMatchObject([{ key: "notice.fill" }]);
    expect(write.move).toMatchObject({
      fills: 2,
      noticeHour: { startedAtMs: testNowMs, sent: 1, held: 0 },
    });
  });

  it("tells a fill of a token only the rule's card names, with the card's decimals and info", async () => {
    const onUnlisted = { ...rule, request: { ...rule.request, token: unlisted } };
    const told = await writeOn(onUnlisted, {
      coinPrice: true,
      cardAssets: { [unlisted]: unlistedInfo },
    });
    const untold = await writeOn(onUnlisted, { coinPrice: true, cardAssets: {} });

    expect(told.notices).toMatchObject([{ key: "notice.fill" }]);
    expect(JSON.stringify(told.notices)).toContain("XVS");
    expect(untold.notices).toBeUndefined();
  });
});
