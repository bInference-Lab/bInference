import type { PriceSource } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { testLimits, testNowMs, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { fillIntentsOf, noticesOf, startFillEngine, wholeToken } from "../orders/test-fills.js";
import { tapCard } from "../orders/test-orders.js";
import type { AgentStore } from "../ports.js";
import { present } from "../surfaces/test-venues.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };
const other = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");

async function activeRule(test: TestEngine, request = testRuleRequest()): Promise<CreatedRule> {
  const created = await createdRule(test, request);
  await tapCard(test, created.intent, "confirm");
  return created;
}

// An agent store that reads every agent archived once `isArchived` holds, as if the owner archived
// it after an alert arrived.
function archivedOnce(store: AgentStore, isArchived: () => boolean): AgentStore {
  return {
    ...store,
    get: async (agent, call) => {
      const settings = await store.get(agent, call);
      return settings === undefined || !isArchived()
        ? settings
        : { ...settings, agent: { ...settings.agent, archivedAtMs: 1 } };
    },
  };
}

// A price source that answers no price of the test token once `isQuiet` holds.
function quietToken(source: PriceSource, isQuiet: () => boolean): PriceSource {
  return {
    ...source,
    usdPrice: async (asset, call) =>
      isQuiet() && asset === testToken ? err("no_price" as const) : source.usdPrice(asset, call),
  };
}

async function alertsOf(test: TestEngine, created: CreatedRule) {
  return test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 50 }, live);
}

describe("an accepted alert at the head of its agent's line", () => {
  it("is skipped, untold, once its agent was archived after it arrived", async () => {
    let isArchived = false;
    const test = await startFillEngine({
      agents: (store) => archivedOnce(store, () => isArchived),
    });
    const created = await activeRule(test);
    expect(await alertTo(test, created.url)).toBe("accepted");
    isArchived = true;

    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "order_inactive" },
    ]);
    expect(JSON.stringify(noticesOf(test))).not.toContain("notice.webhookSkipped");
  });

  it("ends a fill whose rolling cap another confirmation took, naming the cap", async () => {
    const cap = testLimits.rollingDayUsdMicros;
    const test = await startFillEngine({
      intents: (store) => ({
        ...store,
        confirmedSince: async () => [
          { intentId: other, state: "confirmed", confirmedAtMs: testNowMs, valueUsdMicros: cap },
        ],
      }),
    });
    const created = await activeRule(test);
    await alertTo(test, created.url);

    await test.engine.fillWebhookAlerts(live);

    const [filled] = await fillIntentsOf(test);
    expect(filled).toMatchObject({ state: "failed_check", reason: "daily_cap" });
    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "daily_cap", intentId: filled?.id },
    ]);
    expect(JSON.stringify(noticesOf(test))).toContain("$5,000.00");
  });

  it("skips, and tells, an alert whose sale comes to nothing the wallet holds", async () => {
    const test = await startFillEngine({ tokens: 0n });
    const created = await activeRule(test);
    await alertTo(test, created.url);

    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "nothing_to_sell" },
    ]);
    expect(JSON.stringify(noticesOf(test))).toContain("notice.webhookSkipped");
  });

  it("sizes a sale in dollars at the token's price now", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test, testRuleRequest({ size: { usdMicros: 400_000n } }));
    await alertTo(test, created.url);

    await test.engine.fillWebhookAlerts(live);

    const [filled] = await fillIntentsOf(test);
    expect(filled?.state).toBe("paper_filled");
    expect(requestDocument.decode(present(filled).request)).toMatchObject({
      kind: "sell",
      amount: { base: wholeToken / 2n },
    });
  });

  it("skips a sale sized in dollars while the token has no usable price", async () => {
    let isQuiet = false;
    const test = await startFillEngine({
      priceSource: (source) => quietToken(source, () => isQuiet),
    });
    const created = await activeRule(test, testRuleRequest({ size: { usdMicros: 400_000n } }));
    await alertTo(test, created.url);
    isQuiet = true;

    await test.engine.fillWebhookAlerts(live);

    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "no_price" },
    ]);
  });
});
