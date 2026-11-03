import { err } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { AssetInfos, CardLineView, WebhookRuleView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { testCall, testCallers, type TestEngine } from "../operations/test-engine.js";
import { freeze, startOrderEngine, tapCard } from "../orders/test-orders.js";
import { sha256Hex } from "../records/sha256-hex.js";
import { alertTo, createdRule, routeOf, testRuleRequest } from "./test-webhook-rules.js";

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
