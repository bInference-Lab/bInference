import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { flush, startExecutorBench } from "../executor/test-executor.js";
import type { IntentChange } from "../intents/intent-change.js";
import { testAgent, testAgentDraft, testLimits, testNowMs } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { fillIntentsOf, fillPrices, startFillEngine } from "../orders/test-fills.js";
import { tapCard } from "../orders/test-orders.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { sha256Hex } from "../records/sha256-hex.js";
import {
  alertTo,
  createdRule,
  type CreatedRule,
  routeOf,
  testRuleRequest,
} from "./test-webhook-rules.js";
import { createWebhookIntake } from "./webhook-intake.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";
import { webhookUrlOf } from "./webhook-secret.js";

const live = { signal: new AbortController().signal };

// A rule made active on its card's Confirm.
async function activeRule(test: TestEngine, request = testRuleRequest()): Promise<CreatedRule> {
  const created = await createdRule(test, request);
  await tapCard(test, created.intent, "confirm");
  return created;
}

async function alertsOf(test: TestEngine, rule: WebhookRuleRecord["id"]) {
  return test.stores.webhookRules.alerts({ ruleId: rule, limit: 50 }, live);
}

// The rule's record as it is stored now.
async function recordOf(
  test: TestEngine,
  rule: WebhookRuleRecord["id"],
): Promise<WebhookRuleRecord> {
  const record = await test.stores.webhookRules.get(rule, live);
  if (record === undefined) {
    throw new Error(`Expected rule ${rule} to be stored.`);
  }
  return record;
}

// Plants a copy of a stored rule as no operation could make it, with its own URL: of another
// agent, or live. Answers the copy's URL.
async function plantedRule(
  test: TestEngine,
  copy: {
    readonly of: CreatedRule;
    readonly n: number;
    readonly changes: Partial<WebhookRuleRecord>;
  },
): Promise<string> {
  const record = {
    ...(await recordOf(test, copy.of.rule)),
    id: fixtureId("whr", copy.n),
    ...copy.changes,
  };
  const secret = "s".repeat(42) + String(copy.n % 10);
  test.stores.webhookRules.plant(record, sha256Hex(secret));
  return webhookUrlOf("http://127.0.0.1:7457", record.id, secret);
}

// An intent store that stops the run, as a crash does, right after the move `after` picks commits.
function stoppingAfter(
  store: IntentStore,
  stop: { readonly controller: AbortController; readonly after: (change: IntentChange) => boolean },
): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (stop.after(change)) {
        stop.controller.abort();
      }
      return moved;
    },
  };
}

// The fill's own confirmation, which carries no card.
const isFillConfirmed = (change: IntentChange): boolean =>
  change.state === "confirmed" && change.confirmation === undefined;

/** A fault armed by the test, which tells when the run reached it. */
interface Fault {
  readonly isArmed: () => boolean;
  readonly arm: (state: { readonly isArmed: boolean }) => void;
  readonly reached: Promise<void>;
  readonly reach: () => void;
}

function faultOf(): Fault {
  const state = { isArmed: false };
  const told: { reach?: () => void } = {};
  const reached = new Promise<void>((resolve) => {
    told.reach = resolve;
  });
  return {
    isArmed: () => state.isArmed,
    arm: (next) => {
      state.isArmed = next.isArmed;
    },
    reached,
    reach: () => told.reach?.(),
  };
}

// An agent store whose reads throw while the fault is armed, as a store that does not answer.
function failingWhileArmed(store: AgentStore, fault: Fault): AgentStore {
  return {
    ...store,
    get: async (agent, call) => {
      if (fault.isArmed()) {
        throw new Error("The agent store did not answer.");
      }
      return store.get(agent, call);
    },
  };
}

// An intent store whose write of a quote of the test agent never answers once armed.
function hangingAtQuote(store: IntentStore, fault: Fault): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const record = await store.get(change.id, call);
      if (fault.isArmed() && change.state === "quoted" && record?.agentId === testAgent) {
        fault.reach();
        return new Promise(() => undefined);
      }
      return store.transition(change, call);
    },
  };
}

describe("a webhook rule's fill a stop or a fault cut short", () => {
  it("is cancelled at the next start, frees its cap, and a start in the minute fills no second", async () => {
    const controller = new AbortController();
    const test = await startFillEngine({
      agent: { limits: { ...testLimits, rollingDayUsdMicros: 500_000n } },
      intents: (store) => stoppingAfter(store, { controller, after: isFillConfirmed }),
    });
    const created = await activeRule(test);
    await alertTo(test, created.url, "one");

    const run = test.engine.fillWebhookAlerts({ signal: controller.signal });
    expect(
      await run.then(
        () => "ran",
        () => "stopped",
      ),
    ).toBe("stopped");
    await test.restart().repairOrderFills(live);
    await test.restart().fillWebhookAlerts(live);

    const [stopped] = await fillIntentsOf(test);
    expect(await fillIntentsOf(test)).toMatchObject([{ state: "cancelled" }]);
    expect(await alertsOf(test, created.rule)).toMatchObject([
      { outcome: "skipped", reason: "fill_failed", intentId: stopped?.id },
    ]);
    await alertTo(test, created.url, "two");
    await test.restart().fillWebhookAlerts(live);
    expect((await fillIntentsOf(test)).map(({ state }) => state)).toContain("paper_filled");
  });

  it("cancels the intent of a fill past its deadline, and ends its alert fill_failed", async () => {
    const fault = faultOf();
    const test = await startFillEngine({ intents: (store) => hangingAtQuote(store, fault) });
    const created = await activeRule(test);
    await alertTo(test, created.url, "one");
    fault.arm({ isArmed: true });

    const run = test.engine.fillWebhookAlerts(live);
    await fault.reached;
    fault.arm({ isArmed: false });
    await test.clock.advance(30_000);
    await run;

    expect(await fillIntentsOf(test)).toMatchObject([{ state: "cancelled" }]);
    expect(await alertsOf(test, created.rule)).toMatchObject([
      { outcome: "skipped", reason: "fill_failed" },
    ]);
  });

  it("ends another agent's alert while one agent's fill hangs", async () => {
    const fault = faultOf();
    const test = await startFillEngine({ intents: (store) => hangingAtQuote(store, fault) });
    const created = await activeRule(test);
    const other = fixtureId("agt", 2);
    await test.stores.agents.create(testAgentDraft({ id: other, name: "other" }), live);
    const otherUrl = await plantedRule(test, { of: created, n: 2, changes: { agentId: other } });
    await alertTo(test, created.url, "first");
    await alertTo(test, otherUrl, "second");
    fault.arm({ isArmed: true });

    const run = test.engine.fillWebhookAlerts(live);
    await fault.reached;
    await flush();
    const [otherAlert] = await alertsOf(test, fixtureId("whr", 2));
    fault.arm({ isArmed: false });
    await test.clock.advance(30_000);
    await run;

    expect(otherAlert?.outcome).toBeDefined();
    expect(await alertsOf(test, created.rule)).toMatchObject([{ reason: "fill_failed" }]);
  });

  it("ends an alert whose run keeps failing, so it never holds the alerts behind it", async () => {
    const fault = faultOf();
    const test = await startFillEngine({ agents: (store) => failingWhileArmed(store, fault) });
    const created = await activeRule(test, testRuleRequest({ ratePerMinute: 60 }));
    await alertTo(test, created.url, "stuck");
    fault.arm({ isArmed: true });

    for (const run of [1, 2, 3]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one run after another, as the timer runs them
      await expect(test.engine.fillWebhookAlerts(live), `run ${String(run)}`).rejects.toThrow(
        "webhook alerts failed to fill",
      );
    }
    fault.arm({ isArmed: false });
    await alertTo(test, created.url, "next");
    await test.engine.fillWebhookAlerts(live);

    expect(await alertsOf(test, created.rule)).toMatchObject([
      { outcome: "filled" },
      { outcome: "skipped", reason: "fill_failed" },
    ]);
  });
});

describe("a webhook alert's time and lock", () => {
  it("skips an alert stamped after now, as a clock set back leaves one, as late", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test);
    const ahead: Clock = { ...test.clock, now: () => test.clock.now() + 30_000 };
    const intake = createWebhookIntake({
      store: test.stores.webhookAlerts,
      clock: ahead,
      isLocked: () => false,
    });
    const body = new TextEncoder().encode("from ahead");
    expect(await intake.take({ ...routeOf(created.url), body }, live)).toBe("accepted");

    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, created.rule)).toMatchObject([
      { outcome: "skipped", reason: "late" },
    ]);
  });

  it("skips an alert taken while the engine was locked, though it ran unlocked", async () => {
    const lock = { isLocked: false };
    const test = await startFillEngine({ isLocked: () => lock.isLocked });
    const created = await activeRule(test);
    lock.isLocked = true;
    await alertTo(test, created.url, "while locked");
    lock.isLocked = false;

    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, created.rule)).toMatchObject([
      { outcome: "skipped", reason: "engine_locked", wasEngineLocked: true },
    ]);
  });
});

describe("a live webhook rule, which no operation makes yet", () => {
  it("ends its alert live_fills_off before any intent is stored", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test);
    const url = await plantedRule(test, { of: created, n: 3, changes: { isPaper: false } });
    await alertTo(test, url, "live");

    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, fixtureId("whr", 3))).toMatchObject([
      { outcome: "skipped", reason: "live_fills_off" },
    ]);
  });

  it("never reaches signing, with live order fills on", async () => {
    const bench = await startExecutorBench({
      engine: { liveOrderFills: true, prices: fillPrices },
    });
    const paper = await startFillEngine();
    const made = await activeRule(
      paper,
      testRuleRequest({ side: "buy", size: { base: 10n ** 15n } }),
    );
    const record = {
      ...(await recordOf(paper, made.rule)),
      isPaper: false,
      createdAtMs: testNowMs,
    };
    const secret = "l".repeat(43);
    bench.test.stores.webhookRules.plant(record, sha256Hex(secret));
    await alertTo(bench.test, webhookUrlOf("http://127.0.0.1:7457", record.id, secret), "live");

    await bench.test.engine.fillWebhookAlerts(live);
    await bench.release();
    await flush();

    expect(bench.signed).toStrictEqual([]);
    expect(await alertsOf(bench.test, record.id)).toMatchObject([
      { outcome: "skipped", reason: "live_fills_off" },
    ]);
  });
});
