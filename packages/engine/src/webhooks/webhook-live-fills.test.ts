import { checkFillGrant, type SignRequest } from "@binference/chain";
import { createIdSource, err, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { expectOk, testCoin, testLimits, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import {
  executorNotices,
  liveFillsOf,
  silentTransfers,
  startLiveFills,
} from "../orders/test-live-fills.js";
import { freeze, tapCard } from "../orders/test-orders.js";
import type { WebhookRuleStore } from "./ports.js";
import { createRuleFillEnd } from "./rule-fill-end.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A live rule that buys the test token with 0.001 of the coin on each alert, five a minute.
const liveBuy = testRuleRequest({ side: "buy", spend: testCoin, size: { base: 10n ** 15n } });

// A rule the CLI made on the live bench and the owner confirmed on its card.
async function activeLiveRule(bench: ExecutorBench, request = liveBuy): Promise<CreatedRule> {
  const created = await createdRule(bench.test, request);
  await tapCard(bench.test, created.intent, "confirm");
  return created;
}

async function alertsOf(bench: ExecutorBench, created: CreatedRule) {
  return bench.test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 50 }, live);
}

// An alert to the rule's URL, then a run of the rule fills and the executor's work.
async function alertAndFill(bench: ExecutorBench, created: CreatedRule, body: string) {
  expect(await alertTo(bench.test, created.url, body)).toBe("accepted");
  await bench.test.engine.fillWebhookAlerts(live);
  await flush();
}

// The owner withdraws a confirmed fill before it signs, as an `intent/cancel` call of theirs would.
async function ownerCancels(bench: ExecutorBench, intent: Id<"int">): Promise<void> {
  const { test } = bench;
  const ids = createIdSource({ clock: test.clock, random: createSeededRandom(17) });
  const ruleFillEnd = createRuleFillEnd({ rules: test.stores.webhookRules });
  const stored = createStoredIntents({
    intents: test.stores.intents,
    agents: test.stores.agents,
    ids,
    publish: () => undefined,
    ruleFillEnd,
  });
  const snapshot = await testSnapshot(test, intent);
  const machine = createIntentStateMachine({ clock: test.clock });
  const trigger = { type: "cancel_requested", cause: "request", hasSignedStep: false } as const;
  const step = expectOk(machine.apply(snapshot.stored.status, trigger));
  expectOk(
    await stored.move({ intent, version: snapshot.stored.version, step, by: "tok_owner" }, live),
  );
}

// A rule store whose every count of a fill loses its rule's version to another write, counting
// the tries; a skip writes as it would.
function losingFills() {
  const state = { tries: 0 };
  return {
    tries: () => state.tries,
    wrap: (store: WebhookRuleStore): WebhookRuleStore => ({
      ...store,
      endAlert: async (write, call) => {
        if (write.outcome !== "filled") {
          return store.endAlert(write, call);
        }
        state.tries += 1;
        return Promise.resolve(err("stale"));
      },
    }),
  };
}

// Each signing request's fill grant, held to the check the signer's rule 5 runs.
function grantChecksOf(signed: readonly SignRequest[], nowMs: number) {
  return signed.map((request) => {
    const { authorization } = request;
    if (authorization.kind !== "fill") {
      return "no fill grant";
    }
    const check = {
      intent: request.intent,
      termsHash: request.termsHash,
      source: authorization.current,
      action: request.step.action,
      isCancel: request.step.replaces?.kind === "cancel",
      stepIndex: request.step.index,
      nowMs,
    };
    const checked = checkFillGrant(authorization.grant, check);
    return checked.ok ? "holds" : checked.error;
  });
}

describe("a live webhook rule's fill", () => {
  it("signs once under its rule's grant, holds the line until it settles, then counts on its rule", async () => {
    const bench = await startLiveFills();
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "first");
    const [intent] = await liveFillsOf(bench);
    await alertAndFill(bench, created, "meanwhile");
    const signedAtMs = bench.test.clock.now();

    expect(grantChecksOf(bench.signed, signedAtMs)).toStrictEqual(["holds"]);
    expect(bench.signed[0]?.authorization).toMatchObject({
      kind: "fill",
      grant: { source: created.rule, fillsBefore: 0, spend: { maxBase: 10n ** 15n } },
      current: { id: created.rule, state: "active", fills: 0 },
    });
    const [waiting, held] = await alertsOf(bench, created);
    expect(waiting).toMatchObject({ outcome: "skipped", reason: "fill_waiting" });
    expect(held?.outcome).toBeUndefined();

    const id = intent?.id as Id<"int">;
    await expect(driveUntil(bench, id, { states: ["reconciled"] })).resolves.toBe("reconciled");
    await flush();

    expect(await alertsOf(bench, created)).toMatchObject([
      { outcome: "skipped", reason: "fill_waiting" },
      { outcome: "filled", intentId: id },
    ]);
    expect(await bench.test.stores.webhookRules.get(created.rule, live)).toMatchObject({
      state: "active",
      fills: 1,
    });
    expect(bench.signed).toHaveLength(1);
    const fills = executorNotices(bench).filter((data) =>
      JSON.stringify(data).includes("notice.fill"),
    );
    expect(fills).toMatchObject([
      {
        key: "notice.fill",
        values: { mode: "live" },
        parts: { orderKind: { key: "fill.webhookRule" } },
      },
    ]);
  });

  it("lapses in the queue past its grant, ends its alert fill_lapsed, and its rule fills again", async () => {
    const bench = await startLiveFills({ hold: true });
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "first");
    await bench.test.clock.advance(60_000);
    await bench.release();
    await flush();
    const [lapsed] = await liveFillsOf(bench);

    expect(lapsed?.state).toBe("expired");
    expect(bench.signed).toStrictEqual([]);
    expect(await alertsOf(bench, created)).toMatchObject([
      { outcome: "skipped", reason: "fill_lapsed", intentId: lapsed?.id },
    ]);
    await alertAndFill(bench, created, "again");
    await bench.release();
    await flush();
    expect(bench.signed).toHaveLength(1);
  });

  it("refuses at the queue, unsigned, a fill whose alert a rotation took after its confirmation", async () => {
    const bench = await startLiveFills({ hold: true });
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "before the rotation");
    expectOk(
      await bench.test.engine.handlers["webhookRule/rotateUrl"](testCall({ rule: created.rule })),
    );
    await bench.release();
    await flush();
    const [refused] = await liveFillsOf(bench);

    expect(bench.signed).toStrictEqual([]);
    expect(refused?.state).toBe("cancelled");
    expect(await alertsOf(bench, created)).toMatchObject([
      { outcome: "skipped", reason: "url_rotated", intentId: refused?.id },
    ]);
  });

  it("ends its rule when the owner cancels its fill before it signs", async () => {
    const bench = await startLiveFills({ hold: true });
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "cancelled by the owner");
    const [held] = await liveFillsOf(bench);
    await ownerCancels(bench, held?.id as Id<"int">);
    await bench.release();
    await flush();

    expect(bench.signed).toStrictEqual([]);
    expect(await alertsOf(bench, created)).toMatchObject([
      { outcome: "skipped", reason: "owner_cancelled", intentId: held?.id },
    ]);
    expect((await bench.test.stores.webhookRules.get(created.rule, live))?.state).toBe("deleted");
  });

  it("ends its alert frozen when a freeze cancels it before it signs, the rule kept", async () => {
    const bench = await startLiveFills({ hold: true });
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "before the freeze");
    const [held] = await liveFillsOf(bench);
    await freeze(bench.test);
    await bench.release();
    await flush();

    expect(bench.signed).toStrictEqual([]);
    expect(await alertsOf(bench, created)).toMatchObject([
      { outcome: "skipped", reason: "frozen", intentId: held?.id },
    ]);
    expect((await bench.test.stores.webhookRules.get(created.rule, live))?.state).toBe("active");
  });

  it("ends its alert daily_cap when another confirmation took the rolling cap, telling the cap", async () => {
    const cap = testLimits.rollingDayUsdMicros;
    const other = fixtureId("int", 99);
    const bench = await startLiveFills({
      intents: (store) => ({
        ...store,
        confirmedSince: async () => [
          { intentId: other, state: "confirmed", confirmedAtMs: testNowMs, valueUsdMicros: cap },
        ],
      }),
    });
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "over the cap");
    const [alert] = await alertsOf(bench, created);

    expect(bench.signed).toStrictEqual([]);
    expect(alert).toMatchObject({ outcome: "skipped", reason: "daily_cap" });
    expect(alert?.notices).toMatchObject([
      {
        key: "notice.webhookSkipped",
        parts: { reason: { key: "reason.daily_cap", values: { cap: "$5,000.00" } } },
      },
    ]);
  });

  it("ends its alert daily_cap at the queue when the cap was used up meanwhile, telling its use", async () => {
    const cap = testLimits.rollingDayUsdMicros;
    const other = fixtureId("int", 99);
    const used = {
      intentId: other,
      state: "confirmed",
      confirmedAtMs: testNowMs,
      valueUsdMicros: cap,
    } as const;
    const bench = await startLiveFills({
      recentOutflows: [{ atMs: testNowMs, valueUsdMicros: cap }],
      executorIntents: (store) => ({ ...store, confirmedSince: async () => [used] }),
    });
    const created = await activeLiveRule(bench);

    await alertAndFill(bench, created, "over the cap at the queue");
    const [alert] = await alertsOf(bench, created);
    const [refused] = await liveFillsOf(bench);

    expect(bench.signed).toStrictEqual([]);
    expect(refused?.state).toBe("cancelled");
    expect(alert).toMatchObject({ outcome: "skipped", reason: "daily_cap", intentId: refused?.id });
    expect(alert?.notices).toMatchObject([
      {
        key: "notice.webhookSkipped",
        parts: {
          reason: { key: "reason.daily_cap", values: { used: "$5,000.00", cap: "$5,000.00" } },
        },
      },
    ]);
  });

  it("tells no unvalued fill its rule's alert would not count, after reading it again", async () => {
    const silent = silentTransfers();
    const losing = losingFills();
    const bench = await startLiveFills({
      receipts: silent.wrap,
      limits: { settleAfterBlocks: 3 },
      webhookRules: losing.wrap,
    });
    const created = await activeLiveRule(bench);
    await alertAndFill(bench, created, "unvalued");
    const [fill] = await liveFillsOf(bench);
    const id = fill?.id as Id<"int">;

    await driveUntil(bench, id, { states: ["finalized"] });
    await driveUntil(bench, id, { states: [], blocks: 5 });
    await flush();

    expect(losing.tries()).toBe(3);
    expect(bench.logger.records().map(({ event }) => event)).toContain("executor.fill_uncounted");
    expect(executorNotices(bench)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "notice.fillUnvalued" })]),
    );
  });

  it("counts on its rule after the settle wait when its trade cannot be valued, freeing the line", async () => {
    const silent = silentTransfers();
    const bench = await startLiveFills({ receipts: silent.wrap, limits: { settleAfterBlocks: 3 } });
    const created = await activeLiveRule(bench);
    await alertAndFill(bench, created, "unvalued");
    const [fill] = await liveFillsOf(bench);
    const id = fill?.id as Id<"int">;

    await driveUntil(bench, id, { states: ["finalized"] });
    await driveUntil(bench, id, { states: [], blocks: 5 });
    await flush();
    const counted = await alertsOf(bench, created);
    await alertAndFill(bench, created, "next");
    silent.speak();
    await driveUntil(bench, id, { states: ["reconciled"], blocks: 30 });
    await flush();

    expect(counted).toMatchObject([{ outcome: "filled", intentId: id }]);
    expect(bench.signed).toHaveLength(2);
    expect(executorNotices(bench)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "notice.fillUnvalued" })]),
    );
    expect((await liveFillsOf(bench)).find((record) => record.id === id)?.state).toBe("reconciled");
    expect((await bench.test.stores.webhookRules.get(created.rule, live))?.fills).toBe(1);
  });
});
