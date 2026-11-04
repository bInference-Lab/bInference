import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { testRuleRequest } from "../webhooks/test-webhook-rules.js";
import { type WebhookRuleAction, webhookRuleDetailLines } from "./webhook-rule-card-lines.js";

const expiresAtMs = Date.parse("2027-01-01T00:00:00Z");

function ruleAction(changes: Partial<WebhookRuleAction> = {}): WebhookRuleAction {
  return {
    name: "Breakout",
    request: testRuleRequest(),
    spend: testCoin,
    ratePerMinute: 1,
    maxFills: 3,
    expiresAtMs,
    isPaper: true,
    ...changes,
  };
}

const keysOf = (action: WebhookRuleAction): readonly string[] =>
  webhookRuleDetailLines(action).map(({ key }) => key);

describe("a webhook rule card's detail lines (decisions 0337, 0338 and 0342)", () => {
  it("says a paper rule fills on paper only, after its limits and its URL", () => {
    expect(keysOf(ruleAction())).toStrictEqual([
      "card.webhookRule.limits",
      "card.webhookRule.url",
      "card.webhookRule.paper",
    ]);
  });

  it("says a live rule fills with live funds and no tap", () => {
    expect(keysOf(ruleAction({ isPaper: false })).at(-1)).toBe("card.webhookRule.live");
  });

  it("shows the most slippage each fill takes when the rule names it", () => {
    const request = testRuleRequest({ maxSlippageBps: bpsSchema.parse(150) });
    expect(webhookRuleDetailLines(ruleAction({ request }))[1]).toStrictEqual({
      key: "card.webhookRule.slippage",
      values: { slippage: { type: "percent", bps: 150 } },
    });
  });
});
