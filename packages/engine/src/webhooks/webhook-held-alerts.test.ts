import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import { restartBench } from "../executor/test-restart.js";
import type { InboxStore } from "../ingress/ports.js";
import { testAgent, testCoin } from "../intents/test-intents.js";
import { liveFillsOf, startLiveFills } from "../orders/test-live-fills.js";
import { tapCard } from "../orders/test-orders.js";
import type { WebhookRuleStore } from "./ports.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A live rule that buys the test token with 0.001 of the coin on each alert.
const liveBuy = testRuleRequest({ side: "buy", spend: testCoin, size: { base: 10n ** 15n } });

// An inbox whose first mark of an entry handled throws, as a stop right after the fill was handed
// to the executor leaves the entry: the fill goes on, and the next run reads the alert again.
function stopBeforeHandled(): (store: InboxStore) => InboxStore {
  const state = { stopped: false };
  return (store) => ({
    ...store,
    async markHandled(mark, call) {
      if (!state.stopped) {
        state.stopped = true;
        throw new Error("The engine stopped.");
      }
      return store.markHandled(mark, call);
    },
  });
}

// A rule store whose second read of each alert throws: the read after the fill's proposal, as a
// fault or a stop's abort leaves it once the fill was handed to the executor.
function failAfterProposal(): (store: WebhookRuleStore) => WebhookRuleStore {
  const reads = new Map<number, number>();
  return (store) => ({
    ...store,
    async alert(event, call) {
      const count = (reads.get(event) ?? 0) + 1;
      reads.set(event, count);
      if (count === 2) {
        throw new Error("The store did not answer.");
      }
      return store.alert(event, call);
    },
  });
}

async function activeLiveRule(bench: ExecutorBench): Promise<CreatedRule> {
  const created = await createdRule(bench.test, liveBuy);
  await tapCard(bench.test, created.intent, "confirm");
  return created;
}

// The fill's end, once its trade settled: its alert, its rule, its booking and its ledger.
async function endOf(bench: ExecutorBench, created: CreatedRule, fill: Id<"int">) {
  const { stores, positions } = bench.test;
  const alerts = await stores.webhookRules.alerts({ ruleId: created.rule, limit: 10 }, live);
  const rule = await stores.webhookRules.get(created.rule, live);
  const executions = await positions.executions({ isPaper: false, after: 0, limit: 10 }, live);
  const ledger = await stores.ledger.list({ after: 0, limit: 200 }, live);
  const inFlight = await stores.intents.fillsInFlight(
    { agentId: testAgent, droppedSinceMs: 0 },
    live,
  );
  return {
    alerts: alerts.map(({ outcome, reason, intentId }) => ({ outcome, reason, intentId })),
    fills: rule?.fills,
    executions: executions.map(({ intentId }) => intentId),
    reconciled: ledger.filter(({ kind, subject }) => kind === "reconciled" && subject === fill)
      .length,
    hasFillNotice: JSON.stringify(alerts[0]?.notices ?? []).includes("notice.fill"),
    inFlight: inFlight.length,
  };
}

const filledOnce = (fill: Id<"int">) => ({
  alerts: [{ outcome: "filled", reason: undefined, intentId: fill }],
  fills: 1,
  executions: [fill],
  reconciled: 1,
  hasFillNotice: true,
  inFlight: 0,
});

// A live rule's alert whose fill the executor took and sent, while its inbox entry stayed
// unhandled as a stop leaves it.
async function sentWithEntryLeft() {
  const bench = await startLiveFills({ engineStores: { inbox: stopBeforeHandled() } });
  const created = await activeLiveRule(bench);
  expect(await alertTo(bench.test, created.url, "sent before the stop")).toBe("accepted");
  await expect(bench.test.engine.fillWebhookAlerts(live)).rejects.toThrow("failed to fill");
  await flush();
  const [fill] = await liveFillsOf(bench);
  return { bench, created, fill: fill?.id as Id<"int"> };
}

describe("an alert whose live fill the executor holds", () => {
  it("is left to its fill by a start past its minute, which ends it once with its booking", async () => {
    const { bench, created, fill } = await sentWithEntryLeft();

    const restarted = await restartBench(bench, { liveOrderFills: true });
    await bench.test.clock.advance(61_000);
    const engine = bench.test.restart({ liveOrderFills: true });
    await engine.repairOrderFills(live);
    await engine.fillWebhookAlerts(live);
    await driveUntil(bench, fill, { states: ["reconciled"] });
    await flush();
    await engine.fillWebhookAlerts(live);

    expect(await endOf(bench, created, fill)).toStrictEqual(filledOnce(fill));
    expect(await bench.test.stores.inbox.unhandled({ keyPrefix: "", limit: 10 }, live)).toEqual([]);
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });

  it("is left to its fill by a start while locked, which ends it once with its booking", async () => {
    const { bench, created, fill } = await sentWithEntryLeft();

    const restarted = await restartBench(bench, { liveOrderFills: true });
    const engine = bench.test.restart({ liveOrderFills: true, isLocked: () => true });
    await engine.repairOrderFills(live);
    await engine.fillWebhookAlerts(live);
    await driveUntil(bench, fill, { states: ["reconciled"] });
    await flush();

    expect(await endOf(bench, created, fill)).toStrictEqual(filledOnce(fill));
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });

  it("is left to its fill when the run fails after the fill was handed on", async () => {
    const bench = await startLiveFills({ engineStores: { webhookRules: failAfterProposal() } });
    const created = await activeLiveRule(bench);

    expect(await alertTo(bench.test, created.url, "the read after fails")).toBe("accepted");
    await bench.test.engine.fillWebhookAlerts(live);
    await flush();
    const [fill] = await liveFillsOf(bench);
    const id = fill?.id as Id<"int">;
    await driveUntil(bench, id, { states: ["reconciled"] });
    await flush();

    expect(await endOf(bench, created, id)).toStrictEqual(filledOnce(id));
  });
});
