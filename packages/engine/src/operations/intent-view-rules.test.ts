import { describe, expect, it } from "vitest";
import { expectOk, testCoin, testToken } from "../intents/test-intents.js";
import { startOrderEngine } from "../orders/test-orders.js";
import { createdRule, testRuleRequest } from "../webhooks/test-webhook-rules.js";
import { testCall } from "./test-engine.js";

describe("the view of a webhook rule's card", () => {
  it("names the rule its card asks for, and its token's info", async () => {
    const test = await startOrderEngine();
    const { intent, rule } = await createdRule(test);
    const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
    expect(view.request).toStrictEqual({ kind: "webhookRule", rule });
    expect(Object.keys(view.assets)).toStrictEqual([testToken]);
  });

  it("names the coin a buy rule spends beside its token", async () => {
    const test = await startOrderEngine();
    const buy = testRuleRequest({ side: "buy", spend: testCoin, size: { base: 10n ** 15n } });
    const { intent } = await createdRule(test, buy);
    const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
    expect(Object.keys(view.assets).toSorted()).toStrictEqual([testCoin, testToken].toSorted());
  });
});
