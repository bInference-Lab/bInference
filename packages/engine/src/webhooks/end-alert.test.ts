import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { TestEngine } from "../operations/test-engine.js";
import { noticesOf, startFillEngine } from "../orders/test-fills.js";
import { tapCard } from "../orders/test-orders.js";
import { ruleEndingWriteOf } from "./end-alert.js";
import type { WebhookRuleStore } from "./ports.js";
import { alertTo, createdRule, type CreatedRule } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A rule store whose first `times` ends of an alert lose the rule's version to another write.
function staleEnds(store: WebhookRuleStore, times: number): WebhookRuleStore {
  let left = times;
  return {
    ...store,
    endAlert: async (write, call) => {
      if (left > 0) {
        left -= 1;
        return err("stale" as const);
      }
      return store.endAlert(write, call);
    },
  };
}

// An active rule that took one alert, which waited past its minute.
async function lateAlertOn(test: TestEngine): Promise<CreatedRule> {
  const created = await createdRule(test);
  await tapCard(test, created.intent, "confirm");
  await alertTo(test, created.url);
  await test.clock.advance(60_000);
  return created;
}

function skipNotices(test: TestEngine): number {
  return noticesOf(test).filter((data) => JSON.stringify(data).includes("webhookSkipped")).length;
}

describe("ending an alert as skipped", () => {
  it("writes a skip that lost its rule's version again on a fresh read, and tells it", async () => {
    const test = await startFillEngine({ webhookRules: (store) => staleEnds(store, 1) });
    const created = await lateAlertOn(test);

    await test.engine.fillWebhookAlerts(live);

    const alerts = await test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 5 }, live);
    expect(alerts).toMatchObject([{ outcome: "skipped", reason: "late" }]);
    expect(skipNotices(test)).toBe(1);
  });

  it("writes the skip alone at the last try, so every alert ends", async () => {
    const test = await startFillEngine({ webhookRules: (store) => staleEnds(store, 2) });
    const created = await lateAlertOn(test);

    await test.engine.fillWebhookAlerts(live);

    const alerts = await test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 5 }, live);
    expect(alerts).toMatchObject([{ outcome: "skipped", reason: "late" }]);
    expect(skipNotices(test)).toBe(0);
  });
});

describe("a skip that ends its live rule (decision 0342)", () => {
  it("ends a rule deleted already as the skip alone, telling nothing more", async () => {
    const skip = { event: 7, reason: "fill_failed", tells: true } as const;
    const rule = { id: fixtureId("whr", 1), version: 3, state: "deleted" } as never;
    const notice = { key: "notice.webhookRuleFailing" } as never;

    expect(ruleEndingWriteOf(rule, { skip, atMs: 1, notice })).toStrictEqual({
      event: 7,
      outcome: "skipped",
      reason: "fill_failed",
    });
  });
});
