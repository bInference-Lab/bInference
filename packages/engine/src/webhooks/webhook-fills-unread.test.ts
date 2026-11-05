import { describe, expect, it } from "vitest";
import { startFillEngine } from "../orders/test-fills.js";
import { tapCard } from "../orders/test-orders.js";
import type { WebhookRuleStore } from "./ports.js";
import { alertTo, createdRule } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A rule store whose reads of one accepted alert throw while `isDown` holds, as a store that does
// not answer.
function alertReadsDown(store: WebhookRuleStore, isDown: () => boolean): WebhookRuleStore {
  return {
    ...store,
    alert: async (event, call) => {
      if (isDown()) {
        throw new Error("The alert could not be read.");
      }
      return store.alert(event, call);
    },
  };
}

describe("a webhook alert whose entry cannot be read", () => {
  it("fails the run once the rest settled, and no longer holds the queue after its third run", async () => {
    let isDown = false;
    const test = await startFillEngine({
      webhookRules: (store) => alertReadsDown(store, () => isDown),
    });
    const created = await createdRule(test);
    await tapCard(test, created.intent, "confirm");
    await alertTo(test, created.url, "unread");
    isDown = true;

    for (const run of [1, 2, 3]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one run after another, as the timer runs them
      await expect(test.engine.fillWebhookAlerts(live), `run ${String(run)}`).rejects.toThrow(
        "webhook alerts failed to fill",
      );
    }
    isDown = false;
    await test.engine.fillWebhookAlerts(live);

    const waiting = await test.stores.inbox.unhandled({ keyPrefix: "webhook", limit: 5 }, live);
    expect(waiting).toStrictEqual([]);
  });

  it("ends the alert fill_failed in the run that hands its entry off after the third failure", async () => {
    const test = await startFillEngine({
      webhookRules: (store) => alertReadsDown(store, () => true),
    });
    const created = await createdRule(test);
    await tapCard(test, created.intent, "confirm");
    await alertTo(test, created.url, "never read");

    for (const run of [1, 2, 3]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one run after another, as the timer runs them
      await expect(test.engine.fillWebhookAlerts(live), `run ${String(run)}`).rejects.toThrow(
        "webhook alerts failed to fill",
      );
    }

    const waiting = await test.stores.inbox.unhandled({ keyPrefix: "webhook", limit: 5 }, live);
    expect(waiting).toStrictEqual([]);
    const alerts = await test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 5 }, live);
    expect(alerts).toMatchObject([{ outcome: "skipped", reason: "fill_failed" }]);
  });
});
