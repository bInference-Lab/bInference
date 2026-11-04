import { assetRefSchema } from "@binference/chain";
import { bpsSchema, err, idSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { AssetInfos, CardLineView, WebhookRuleView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeTokenFacts } from "../fakes/fake-token-facts.js";
import { expectOk, testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { testCall, testCallers, testChains, type TestEngine } from "../operations/test-engine.js";
import { fillIntentsOf, startFillEngine } from "../orders/test-fills.js";
import { freeze, startOrderEngine, tapCard } from "../orders/test-orders.js";
import { sha256Hex } from "../records/sha256-hex.js";
import type { WebhookRuleStore } from "./ports.js";
import { alertTo, createdRule, routeOf, testRuleRequest } from "./test-webhook-rules.js";
import { webhookRuleViewOf } from "./webhook-rule-view-of.js";

const live = { signal: new AbortController().signal };

async function ruleOf(
  test: TestEngine,
  rule: Parameters<TestEngine["stores"]["webhookRules"]["get"]>[0],
) {
  return test.stores.webhookRules.get(rule, live);
}

describe("webhook rule operations", () => {
  it("answers a rule's URL once, which works only after its card's Confirm", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);

    expect(created.url).toMatch(/^http:\/\/127\.0\.0\.1:7457\/hook\/whr_[^/]+\/[\w-]{43}$/);
    const key = await test.stores.webhookAlerts.findRule(created.rule, live);
    expect(key?.secretHash).toBe(sha256Hex(created.secret));
    expect(await ruleOf(test, created.rule)).toMatchObject({
      state: "awaiting_confirmation",
      isPaper: true,
      ratePerMinute: 5,
      fills: 0,
    });
    expect(await alertTo(test, created.url)).toBe("not_found");

    await tapCard(test, created.intent, "confirm");

    expect((await ruleOf(test, created.rule))?.state).toBe("active");
    expect((await test.stores.intents.get(created.intent, live))?.state).toBe("reconciled");
    expect(await alertTo(test, created.url)).toBe("accepted");
  });

  it("gives every rule a secret of its own and lists rules without it", async () => {
    const test = await startOrderEngine();
    const [first, second] = [await createdRule(test), await createdRule(test)];
    const listed = expectOk(await test.engine.handlers["webhookRule/list"](testCall({})));

    expect(first.secret).not.toBe(second.secret);
    expect(listed.items.map(({ rule }) => rule)).toStrictEqual([first.rule, second.rule]);
    expect(JSON.stringify(listed)).not.toContain(first.secret);
    expect(listed.items[0]).toMatchObject({
      agent: testAgent,
      state: "awaiting_confirmation",
      ratePerMinute: 5,
      request: { name: "BNB breakout", ratePerMinute: 5 },
    });
  });

  it("lists each rule with its card's intent, what each alert trades and its token's info", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    const listed = expectOk(await test.engine.handlers["webhookRule/list"](testCall({})));
    const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
    const [item] = listed.items as [WebhookRuleView];
    const assets = listed.assets as AssetInfos;

    expect(item.intent).toBe(created.intent);
    expect(Object.keys(assets)).toStrictEqual([testToken]);
    expect(cardLineText(item.summary as CardLineView, { formatter, assets })).toBe(
      "sell 50.00% of your TKN on each alert",
    );
  });

  it("pages what each alert became, the newest first, and refuses a cursor it did not write", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    await tapCard(test, created.intent, "confirm");
    const events = test.engine.handlers["webhookRule/events"];
    expect(await alertTo(test, created.url, "first")).toBe("accepted");
    expect(await alertTo(test, created.url, "first")).toBe("repeat");
    expect(await alertTo(test, created.url, "second")).toBe("accepted");

    const page = expectOk(await events(testCall({ rule: created.rule, limit: 2 })));
    expect(page.items.map(({ taken }) => taken)).toStrictEqual(["accepted", "repeat"]);
    expect(page.next).toBe(String(page.items[1]?.event));
    const cursor = page.next as string;
    const rest = expectOk(await events(testCall({ rule: created.rule, limit: 2, cursor })));
    expect(rest).toStrictEqual({
      items: [{ event: 1, receivedAt: test.clock.now(), taken: "accepted" }],
    });
    expect(JSON.stringify([page, rest])).not.toContain("first");
    expect(await events(testCall({ rule: created.rule, cursor: "0" }))).toStrictEqual(
      err("protocol.bad_args"),
    );
  });

  it("deletes a rule at once, after which its URL gets the same 404", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    await tapCard(test, created.intent, "confirm");
    const remove = test.engine.handlers["webhookRule/delete"];

    expect(expectOk(await remove(testCall({ rule: created.rule })))).toStrictEqual({});
    expect(await alertTo(test, created.url)).toBe("not_found");
    expect(await remove(testCall({ rule: created.rule }))).toStrictEqual(err("webhook.not_found"));
  });

  it("deletes a rule awaiting its card and cancels the card", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);

    expectOk(await test.engine.handlers["webhookRule/delete"](testCall({ rule: created.rule })));

    expect((await test.stores.intents.get(created.intent, live))?.state).toBe("cancelled");
    expect((await ruleOf(test, created.rule))?.state).toBe("deleted");
  });

  it("rotates a URL: the old one gets 404 at once, the new one works, and the owner hears it", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    await tapCard(test, created.intent, "confirm");
    const rotate = test.engine.handlers["webhookRule/rotateUrl"];

    const { url } = expectOk(await rotate(testCall({ rule: created.rule })));

    expect(routeOf(url).secret).not.toBe(created.secret);
    expect(await alertTo(test, created.url)).toBe("not_found");
    expect(await alertTo(test, url)).toBe("accepted");
    expect(test.pushes.map(({ data }) => data)).toContainEqual(
      expect.objectContaining({
        key: "notice.webhookRotated",
        agent: testAgent,
        values: { name: "BNB breakout", surface: "cli" },
      }),
    );
  });

  it("ends a rule whose card is cancelled, and one of an agent frozen while it waits", async () => {
    const test = await startOrderEngine();
    const cancelled = await createdRule(test);
    await tapCard(test, cancelled.intent, "deny");
    const waiting = await createdRule(test);

    await freeze(test);

    expect((await ruleOf(test, cancelled.rule))?.state).toBe("deleted");
    await test.engine.tickOrders(live);
    expect((await ruleOf(test, waiting.rule))?.state).toBe("deleted");
    expect(await alertTo(test, waiting.url)).toBe("not_found");
  });

  it("ends a rule past its expiry, which leaves the list and the count of 20, its URL a 404", async () => {
    const test = await startOrderEngine();
    const expiring = await createdRule(test);
    await tapCard(test, expiring.intent, "confirm");
    await Promise.all(Array.from({ length: 19 }, async () => createdRule(test)));
    const create = test.engine.handlers["webhookRule/create"];
    expect(await create(testCall(testRuleRequest()))).toStrictEqual(err("webhook.too_many"));

    await test.clock.advance(31 * 86_400_000);
    await test.engine.tickOrders(live);

    expect((await ruleOf(test, expiring.rule))?.state).toBe("deleted");
    const listed = expectOk(await test.engine.handlers["webhookRule/list"](testCall({})));
    expect(listed.items.map(({ rule }) => rule)).not.toContain(expiring.rule);
    expect(await alertTo(test, expiring.url)).toBe("not_found");
    expect((await create(testCall(testRuleRequest()))).ok).toBe(true);
  });

  it("refuses, storing nothing, a live agent, a broken bound, a 21st rule and a client without confirm", async () => {
    const test = await startOrderEngine();
    const create = test.engine.handlers["webhookRule/create"];
    await Promise.all(Array.from({ length: 20 }, async () => createdRule(test)));
    const coin = testRuleRequest({ token: testCoin });

    expect(await create(testCall(testRuleRequest()))).toStrictEqual(err("webhook.too_many"));
    expect(await create(testCall(coin))).toStrictEqual(err("protocol.bad_args"));
    expect(await create(testCall(testRuleRequest(), testCallers.mcp))).toStrictEqual(
      err("auth.scope"),
    );
    const liveTest = await startOrderEngine({ agent: { mode: "live" } });
    const liveCreate = liveTest.engine.handlers["webhookRule/create"];
    expect(await liveCreate(testCall(testRuleRequest()))).toStrictEqual(
      err("order.live_fills_off"),
    );
    const listed = expectOk(await liveTest.engine.handlers["webhookRule/list"](testCall({})));
    expect(listed.items).toStrictEqual([]);
  });

  it("refuses a change of a rule that is not active or awaiting its card", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    await tapCard(test, created.intent, "deny");
    const rotate = test.engine.handlers["webhookRule/rotateUrl"];

    expect(await rotate(testCall({ rule: created.rule }))).toStrictEqual(err("webhook.not_found"));
  });
});

// A rule store whose first `times` moves lose their race, as another write of the rule beat each.
function staleMoves(store: WebhookRuleStore, times: number): WebhookRuleStore {
  let left = times;
  return {
    ...store,
    move: async (move, call) => {
      if (left > 0) {
        left -= 1;
        return err("stale" as const);
      }
      return store.move(move, call);
    },
  };
}

describe("webhook rule operations, further", () => {
  it("lists a buy rule with the tokens it spends and buys and its most fills", async () => {
    const test = await startOrderEngine();
    const request = testRuleRequest({
      side: "buy",
      size: { usdMicros: 25_000_000n },
      maxFills: 3,
      maxSlippageBps: bpsSchema.parse(40),
    });
    const created = await createdRule(test, request);

    const listed = expectOk(await test.engine.handlers["webhookRule/list"](testCall({})));

    expect(listed.items).toMatchObject([
      { rule: created.rule, request: { side: "buy", maxFills: 3 } },
    ]);
    expect(Object.keys(listed.assets as AssetInfos).toSorted()).toStrictEqual(
      [testCoin, testToken].toSorted(),
    );
    expect((await ruleOf(test, created.rule))?.maxFills).toBe(3);
  });

  it("shows of each alert its id, what it became, why it was skipped and the intent that filled it", async () => {
    const test = await startFillEngine();
    const created = await createdRule(test);
    await tapCard(test, created.intent, "confirm");
    await alertTo(test, created.url, '{"id":"a-1"}');
    await test.engine.fillWebhookAlerts(live);
    await alertTo(test, created.url, '{"id":"a-2"}');
    await test.clock.advance(60_000);
    await test.engine.fillWebhookAlerts(live);

    const page = expectOk(
      await test.engine.handlers["webhookRule/events"](testCall({ rule: created.rule })),
    );

    expect(page.items).toMatchObject([
      { taken: "accepted", alertId: "a-2", fill: "skipped", reason: "late" },
      { taken: "accepted", alertId: "a-1", fill: "filled" },
    ]);
    const [filled] = await fillIntentsOf(test);
    expect(page.items[1]?.intent).toBe(filled?.id);
    expect(page.items[0]?.intent).toBeUndefined();
  });

  it("refuses, storing nothing, an unknown or frozen agent, another wallet and a token that names nothing", async () => {
    const silent = assetRefSchema.parse("fake:1/token:0x000000ab");
    const test = await startOrderEngine({
      tokenFacts: createFakeTokenFacts({ unreadable: [silent] }).read,
    });
    const create = test.engine.handlers["webhookRule/create"];
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    const other = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");

    expect(await create(testCall(testRuleRequest({ agent: stranger })))).toStrictEqual(
      err("agent.not_found"),
    );
    expect(await create(testCall(testRuleRequest({ wallet: other })))).toStrictEqual(
      err("wallet.not_found"),
    );
    expect(await create(testCall(testRuleRequest({ token: silent })))).toStrictEqual(
      err("asset.unreadable"),
    );
    await freeze(test);
    expect(await create(testCall(testRuleRequest()))).toStrictEqual(err("agent.frozen"));
    const listed = expectOk(await test.engine.handlers["webhookRule/list"](testCall({})));
    expect(listed.items).toStrictEqual([]);
  });

  it("deletes a rule another write moved first, under the version it moved to", async () => {
    const test = await startOrderEngine({ webhookRules: (store) => staleMoves(store, 1) });
    const created = await createdRule(test);

    expectOk(await test.engine.handlers["webhookRule/delete"](testCall({ rule: created.rule })));

    expect((await ruleOf(test, created.rule))?.state).toBe("deleted");
  });

  it("ends a rule whose card was confirmed after the rule expired", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(
      test,
      testRuleRequest({ expiresAt: test.clock.now() + 60_000 }),
    );
    await test.clock.advance(120_000);

    await tapCard(test, created.intent, "confirm");

    expect((await ruleOf(test, created.rule))?.state).toBe("deleted");
    expect(await alertTo(test, created.url)).toBe("not_found");
  });

  it("ends at the card timer a waiting rule whose card's intent was never stored", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    const stored = await ruleOf(test, created.rule);
    const orphan = idSchema("whr").parse("whr_0190f1c2-3a4b-7c5d-8e6f-0000000000ee");
    const lost = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000ee");
    test.stores.webhookRules.plant(
      { ...(stored as NonNullable<typeof stored>), id: orphan, intentId: lost },
      sha256Hex("o".repeat(43)),
    );

    await test.engine.tickOrders(live);

    expect((await ruleOf(test, orphan))?.state).toBe("deleted");
    expect((await ruleOf(test, created.rule))?.state).toBe("awaiting_confirmation");
  });

  it("shows a rule's last alert, and no summary once its token's chain left the registry", async () => {
    const test = await startOrderEngine();
    const created = await createdRule(test);
    const stored = await ruleOf(test, created.rule);
    const gone = assetRefSchema.parse("fake:9/token:0x0000000a");
    const rule = stored as NonNullable<typeof stored>;

    const view = webhookRuleViewOf(
      { ...rule, lastAlertAtMs: 5, request: { ...rule.request, token: gone } },
      testChains(),
    );

    expect(view.lastAlertAt).toBe(5);
    expect(view.summary).toBeUndefined();
    expect(webhookRuleViewOf(rule, testChains()).summary).toBeDefined();
  });

  it("gives up a change whose every try another write beat, changing nothing", async () => {
    const test = await startOrderEngine({ webhookRules: (store) => staleMoves(store, 99) });
    const created = await createdRule(test);

    expect(
      await test.engine.handlers["webhookRule/delete"](testCall({ rule: created.rule })),
    ).toStrictEqual(err("internal.error"));
    expect((await ruleOf(test, created.rule))?.state).toBe("awaiting_confirmation");
  });

  it("fills a rule's defaults: one alert a minute, 30 days and no fill limit", async () => {
    const test = await startOrderEngine();
    const { ratePerMinute: _rate, ...request } = testRuleRequest();
    const created = await createdRule(test, request);

    expect(await ruleOf(test, created.rule)).toMatchObject({
      ratePerMinute: 1,
      expiresAtMs: test.clock.now() + 30 * 86_400_000,
      request: { ratePerMinute: 1, expiresAt: test.clock.now() + 30 * 86_400_000 },
    });
    expect((await ruleOf(test, created.rule))?.maxFills).toBeUndefined();
  });

  it("refuses a change of a rule it never stored", async () => {
    const test = await startOrderEngine();
    const unknown = { rule: idSchema("whr").parse("whr_0190f1c2-3a4b-7c5d-8e6f-0000000000ff") };

    expect(await test.engine.handlers["webhookRule/rotateUrl"](testCall(unknown))).toStrictEqual(
      err("webhook.not_found"),
    );
    expect(await test.engine.handlers["webhookRule/delete"](testCall(unknown))).toStrictEqual(
      err("webhook.not_found"),
    );
  });
});
