import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakeTokenFacts } from "../fakes/fake-token-facts.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { createdOrder, startOrderEngine, tapCard, testStopLoss } from "./test-orders.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
// A token the registry does not list.
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");

// The card each order opens, line by line, as a surface without buttons writes it in English.
// Each order is confirmed before the next, so a later exit order's position holds an active one.
async function cardOf(requests: readonly Parameters<typeof createdOrder>[1][]) {
  const test = await startOrderEngine();
  return requests.reduce<Promise<readonly (readonly string[])[]>>(async (done, request) => {
    const texts = await done;
    const { intent } = await createdOrder(test, request);
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    await tapCard(test, intent, "confirm");
    const display = { formatter, assets: card.assets };
    return [...texts, card.lines.map((line) => cardLineText(line, display))];
  }, Promise.resolve([]));
}

// The icons of spec 4, built from their code points: no emoji sits in code.
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);

describe("an auto order's card in English", () => {
  it("shows the order's terms, the linked exits, what the agent says and the card's expiry", async () => {
    const [first, second] = await cardOf([
      undefined,
      { ...testStopLoss(), kind: "takeProfit", trigger: { price: 2_500_000n } },
    ]);

    expect(first).toStrictEqual([
      `${waiting} Confirm auto order · main · ${paper} Paper`,
      `Approve Stop-loss: sell all your TKN when the price falls to $0.80 · up to 1 fill until ${formatter.dateTime(testNowMs + 2_592_000_000)}`,
      `${paper} Paper mode: nothing is sent on chain`,
      'Agent says  "Protect the position as you asked"',
      `Expires at ${formatter.time(testNowMs + 600_000)}`,
    ]);
    expect(second).toContain(
      "When an exit order sells all your TKN, your other exit orders on it end",
    );
  });

  it("words a limit buy and a share sold by a trailing stop, each with one fill", async () => {
    const [buy, trailing] = await cardOf([
      {
        ...testStopLoss(),
        kind: "limit",
        side: "buy",
        size: { usdMicros: 25_000_000n },
        trigger: { price: 500_000n, direction: "below" },
      },
      {
        ...testStopLoss(),
        kind: "trailing",
        size: { percentBps: bpsSchema.parse(5_000) },
        trigger: { distanceBps: bpsSchema.parse(800) },
      },
    ]);

    expect(buy?.[1]).toMatch(
      /^Approve Limit order: buy TKN with \$25\.00 of FAKE when the price is at or below \$0\.50 · up to 1 fill until /,
    );
    expect(trailing?.[1]).toMatch(
      /^Approve Trailing stop: sell 50\.00% of your TKN when the price falls 8\.00% below its highest since the order started · up to 1 fill until /,
    );
  });

  it("words a DCA order's period, its zone and its count of buys", async () => {
    const [dca, open] = await cardOf([
      {
        ...testStopLoss(),
        kind: "dca",
        side: "buy",
        size: { usdMicros: 10_000_000n },
        trigger: { cron: "0 9 * * 1-5", timezone: "Asia/Shanghai", count: 20 },
      },
      {
        ...testStopLoss(),
        kind: "dca",
        side: "buy",
        size: { usdMicros: 10_000_000n },
        trigger: { cron: "0 9 * * *" },
      },
    ]);

    expect(dca?.[1]).toMatch(
      /^Approve DCA: buy TKN with \$10\.00 of FAKE on the schedule 0 9 \* \* 1-5 \(Asia\/Shanghai\), 20 times · up to 20 fills until /,
    );
    expect(open?.[1]).toMatch(
      /^Approve DCA: buy TKN with \$10\.00 of FAKE on the schedule 0 9 \* \* \* \(UTC\), until the order ends · no fill limit until /,
    );
  });

  it("words a buy by share of what the wallet may spend, and by an amount", async () => {
    const buy = { ...testStopLoss(), kind: "limit", side: "buy" } as const;
    const trigger = { price: 500_000n, direction: "below" } as const;
    const [byShare, byAmount] = await cardOf([
      { ...buy, trigger, size: { percentBps: bpsSchema.parse(2_500) } },
      { ...buy, trigger, size: { base: 1_500_000_000_000_000_000n } },
    ]);

    expect(byShare?.[1]).toMatch(
      /^Approve Limit order: buy TKN with 25\.00% of your spendable FAKE when the price is at or below \$0\.50 · /,
    );
    expect(byAmount?.[1]).toMatch(
      /^Approve Limit order: buy TKN with 1\.5 FAKE when the price is at or below \$0\.50 · /,
    );
  });

  it("names a token the registry does not list by what it answered, with its short address", async () => {
    const facts = new Map([[unlisted, { symbol: "XVS", name: "Venus", decimals: 18 }]]);
    const test = await startOrderEngine({ tokenFacts: createFakeTokenFacts({ facts }).read });
    const { intent } = await createdOrder(test, testStopLoss({ token: unlisted }));
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    const lines = card.lines.map((line) => cardLineText(line, { formatter, assets: card.assets }));

    expect(lines[1]).toMatch(
      /^Approve Stop-loss: sell all your XVS \(0x0000000f\) when the price falls to \$0\.80 · /,
    );
  });

  it("refuses an order on an unlisted token that answers no symbol or decimals", async () => {
    const tokenFacts = createFakeTokenFacts({ unreadable: [unlisted] }).read;
    const test = await startOrderEngine({ tokenFacts });
    const refused = await test.engine.handlers["order/create"](
      testCall(testStopLoss({ token: unlisted })),
    );

    expect(refused).toStrictEqual({ ok: false, error: "asset.unreadable" });
    expect(expectOk(await test.engine.handlers["order/list"](testCall({}))).items).toStrictEqual(
      [],
    );
  });
});

describe("an auto order held by the agent's launch wallet", () => {
  it("names the launch wallet on its card, as every card of such an intent does", async () => {
    const launch = fixtureId("wal", 217);
    const test = await startOrderEngine({
      wallets: [testWallet, launch],
      custodyWallets: new Map([[launch, accountRefSchema.parse("fake:1:0x000000d9")]]),
    });
    test.stores.install.addWallet(
      testWalletRecord({
        id: launch,
        agentId: testAgent,
        label: "curves",
        createdAtMs: testNowMs,
        role: "launch",
      }),
    );

    const { intent } = await createdOrder(test, testStopLoss({ wallet: launch }));
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));

    expect(card.lines[2]).toStrictEqual({
      key: "card.launchWallet",
      values: { wallet: { type: "text", text: "curves" } },
    });
  });
});
