import type { PriceSource } from "@binference/chain";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { IntentChange } from "../intents/intent-change.js";
import type { TestEngine } from "../operations/test-engine.js";
import { fillIntentsOf, noticesOf, startFillEngine } from "../orders/test-fills.js";
import { tapCard } from "../orders/test-orders.js";
import type { IntentStore } from "../ports.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// The fill's own confirmation, which carries no card.
const isFillConfirmed = (change: IntentChange): boolean =>
  change.state === "confirmed" && change.confirmation === undefined;

// What happens the moment a fill's intent is confirmed, before its paper fill runs: nothing until
// the test sets it.
interface AtConfirmation {
  readonly set: (step: () => Promise<void>) => void;
  readonly run: () => Promise<void>;
}

const nothing = async (): Promise<void> => Promise.resolve();

function atConfirmation(): AtConfirmation {
  let step = nothing;
  return {
    set: (next) => {
      step = next;
    },
    run: async () => step(),
  };
}

// An intent store that runs the test's step right after it writes a fill's confirmation.
function stepAtConfirmation(store: IntentStore, step: AtConfirmation): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (isFillConfirmed(change)) {
        await step.run();
      }
      return moved;
    },
  };
}

async function activeRule(test: TestEngine, request = testRuleRequest()): Promise<CreatedRule> {
  const created = await createdRule(test, request);
  await tapCard(test, created.intent, "confirm");
  return created;
}

// The keys of the skip notices the engine sent, oldest first.
function skipNotices(test: TestEngine): readonly string[] {
  return noticesOf(test)
    .map((data) => JSON.stringify(data))
    .filter((text) => text.includes("notice.webhookSkipped"));
}

async function alertsOf(test: TestEngine, created: CreatedRule) {
  return test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 50 }, live);
}

// A price source that answers no price once `isQuiet` holds, as a feed that went quiet.
function quietPrices(source: PriceSource, isQuiet: () => boolean): PriceSource {
  return {
    ...source,
    usdPrice: async (asset, options) =>
      isQuiet() ? err("no_price" as const) : source.usdPrice(asset, options),
  };
}

// Deletes the rule as its owner would, under the version it stands at now.
async function deleteRule(test: TestEngine, created: CreatedRule): Promise<void> {
  const rule = await test.stores.webhookRules.get(created.rule, live);
  if (rule === undefined) {
    throw new Error("The rule is not stored.");
  }
  const move = { id: rule.id, expectedVersion: rule.version, state: "deleted" } as const;
  await test.stores.webhookRules.move({ ...move, atMs: test.clock.now() }, live);
}

describe("a webhook rule's paper fill", () => {
  it("cancels a fill whose rule was deleted after it was confirmed, and skips its alert untold", async () => {
    const step = atConfirmation();
    const test = await startFillEngine({ intents: (store) => stepAtConfirmation(store, step) });
    const created = await activeRule(test);
    step.set(async () => deleteRule(test, created));

    await alertTo(test, created.url, "BNBUSDT crossed 600");
    await test.engine.fillWebhookAlerts(live);

    expect((await fillIntentsOf(test)).map(({ state }) => state)).toStrictEqual(["cancelled"]);
    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "order_inactive" },
    ]);
    expect((await test.stores.webhookRules.get(created.rule, live))?.fills).toBe(0);
    expect(skipNotices(test)).toStrictEqual([]);
  });

  it("cancels a fill no side of which has a usable price after three tries, and tells it", async () => {
    const step = atConfirmation();
    let isQuiet = false;
    const test = await startFillEngine({
      intents: (store) => stepAtConfirmation(store, step),
      priceSource: (source) => quietPrices(source, () => isQuiet),
    });
    const created = await activeRule(test);
    step.set(async () => {
      isQuiet = true;
      return Promise.resolve();
    });

    await alertTo(test, created.url, "BNBUSDT crossed 600");
    await test.engine.fillWebhookAlerts(live);

    expect((await fillIntentsOf(test)).map(({ state }) => state)).toStrictEqual(["cancelled"]);
    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "no_price" },
    ]);
    expect(skipNotices(test)).toHaveLength(1);
  });
});
