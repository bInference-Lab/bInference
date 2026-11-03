import type { ReceiptReader } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import { testCoin } from "../intents/test-intents.js";
import { liveFillsOf, startLiveFills } from "../orders/test-live-fills.js";
import { tapCard } from "../orders/test-orders.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A live rule that buys the test token with 0.001 of the coin on each alert, 60 a minute.
const busyBuy = testRuleRequest({
  side: "buy",
  spend: testCoin,
  size: { base: 10n ** 15n },
  ratePerMinute: 60,
});

async function activeRule(bench: ExecutorBench): Promise<CreatedRule> {
  const created = await createdRule(bench.test, busyBuy);
  await tapCard(bench.test, created.intent, "confirm");
  return created;
}

// Receipts under which every transaction a block holds reverted, as a token that refuses its buys.
function everyReceiptReverts(network: FakeNetwork): ReceiptReader {
  return {
    ...network,
    receipt: async (chain, hash, call) => {
      const receipt = await network.receipt(chain, hash, call);
      return receipt === undefined ? undefined : { ...receipt, status: "reverted" };
    },
  };
}

// A run over one more alert, a second after the last: the fill it proposed, or none.
async function nextAlert(
  bench: ExecutorBench,
  created: CreatedRule,
): Promise<Id<"int"> | undefined> {
  await bench.test.clock.advance(1_000);
  const before = new Set((await liveFillsOf(bench)).map(({ id }) => id));
  expect(await alertTo(bench.test, created.url, `at ${String(bench.test.clock.now())}`)).toBe(
    "accepted",
  );
  await bench.test.engine.fillWebhookAlerts(live);
  await flush();
  return (await liveFillsOf(bench)).find(({ id }) => !before.has(id))?.id;
}

// Alerts a second apart until one fills; answers how many were skipped before it.
async function skipsUntilFill(bench: ExecutorBench, created: CreatedRule) {
  const step = async (skipped: number): Promise<{ skipped: number; fill: Id<"int"> }> => {
    const fill = await nextAlert(bench, created);
    return fill === undefined ? step(skipped + 1) : { skipped, fill };
  };
  return step(0);
}

describe("a busy live rule whose fills revert", () => {
  it("backs off past the alerts it skips, then ends after its fifth failure and tells the owner", async () => {
    const bench = await startLiveFills({ receipts: everyReceiptReverts });
    const created = await activeRule(bench);

    const waits = await [1, 2, 3, 4, 5].reduce<Promise<readonly number[]>>(async (done) => {
      const counts = await done;
      const { skipped, fill } = await skipsUntilFill(bench, created);
      await expect(driveUntil(bench, fill, { states: ["failed_onchain"] })).resolves.toBe(
        "failed_onchain",
      );
      await flush();
      return [...counts, skipped];
    }, Promise.resolve([]));
    await bench.test.engine.fillWebhookAlerts(live);

    // The first fill and the one after a single failure go at once; from the second failure each
    // fill waits 15 seconds, doubling, the skipped alerts never pushing a failure out.
    expect(waits.slice(0, 2)).toStrictEqual([0, 0]);
    expect(waits[2]).toBeGreaterThanOrEqual(13);
    expect(waits[3]).toBeGreaterThanOrEqual(28);
    expect(waits[3]).toBeLessThan(31);
    expect(waits[4]).toBeGreaterThanOrEqual(58);
    const rule = await bench.test.stores.webhookRules.get(created.rule, live);
    expect(rule?.state).toBe("deleted");
    const [last] = await bench.test.stores.webhookRules.alerts(
      { ruleId: created.rule, limit: 1 },
      live,
    );
    expect(last).toMatchObject({ outcome: "skipped", reason: "reverted" });
    expect(last?.notices).toMatchObject([
      {
        key: "notice.webhookRuleFailing",
        values: { count: "5" },
        parts: { orderKind: { key: "fill.webhookRule", values: { name: "BNB breakout" } } },
      },
    ]);
    expect(await alertTo(bench.test, created.url, "after the end")).not.toBe("accepted");
  });
});
