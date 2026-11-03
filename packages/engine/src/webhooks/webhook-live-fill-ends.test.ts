import type { AccountRef, Amount, RelaySender } from "@binference/chain";
import { err, type Id, idSchema } from "@binference/core";
import type { WebhookRuleRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { benchChain, driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import { restartBench } from "../executor/test-restart.js";
import type { IntentChange } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import { wholeToken } from "../orders/test-fills.js";
import {
  executorNotices,
  liveFillsOf,
  silentTransfers,
  startLiveFills,
} from "../orders/test-live-fills.js";
import { tapCard } from "../orders/test-orders.js";
import type { IntentStore } from "../ports.js";
import type { WebhookRuleStore } from "./ports.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A live rule that sells half the test token the wallet holds on each alert: an approval, then
// the swap.
const liveSale = testRuleRequest();
// A live rule that buys the test token with 0.001 of the coin on each alert: one step.
const liveBuy = testRuleRequest({ side: "buy", spend: testCoin, size: { base: 10n ** 15n } });

// One whole test token held by the test wallet, which the rule's sale sells half of.
function heldTokens(): ReadonlyMap<AccountRef, readonly Amount[]> {
  return new Map([[testAccount, [{ asset: testToken, base: wholeToken }]]]);
}

async function activeRule(bench: ExecutorBench, request: WebhookRuleRequest): Promise<CreatedRule> {
  const created = await createdRule(bench.test, request);
  await tapCard(bench.test, created.intent, "confirm");
  return created;
}

// An alert to the rule's URL and a run of the rule fills; answers the fill it proposed.
async function filledAlert(
  bench: ExecutorBench,
  created: CreatedRule,
  kind: "buy" | "sell",
): Promise<Id<"int">> {
  expect(await alertTo(bench.test, created.url, `a ${kind}`)).toBe("accepted");
  await bench.test.engine.fillWebhookAlerts(live);
  await flush();
  const [fill] = await liveFillsOf(bench, kind);
  return fill?.id as Id<"int">;
}

async function alertsOf(bench: ExecutorBench, created: CreatedRule) {
  const alerts = await bench.test.stores.webhookRules.alerts(
    { ruleId: created.rule, limit: 10 },
    live,
  );
  return alerts.map(({ outcome, reason, intentId }) => ({ outcome, reason, intentId }));
}

async function fillsOf(bench: ExecutorBench, created: CreatedRule) {
  return (await bench.test.stores.webhookRules.get(created.rule, live))?.fills;
}

// Relays that act once, right after the first send of a fill, once armed.
function atFirstSend() {
  const armed: { act?: () => Promise<void> } = {};
  const sender = (relays: RelaySender): RelaySender => ({
    relays: relays.relays,
    async send(transaction, call) {
      const sent = await relays.send(transaction, call);
      const { act } = armed;
      delete armed.act;
      await act?.();
      return sent;
    },
  });
  const arm = (act: () => Promise<void>): void => {
    armed.act = act;
  };
  return { sender, arm };
}

// Relays that hang after the first send, the sale's approval, as an engine a crash stops there.
function hangAfterFirstSend() {
  const state = { sends: 0 };
  const arrival = { arrive: (): void => undefined };
  const reached = new Promise<void>((resolve) => {
    arrival.arrive = resolve;
  });
  const sender = (relays: RelaySender): RelaySender => ({
    relays: relays.relays,
    async send(transaction, call) {
      const sent = await relays.send(transaction, call);
      state.sends += 1;
      if (state.sends > 1) {
        return sent;
      }
      arrival.arrive();
      await new Promise<void>((resolve) => {
        call.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return sent;
    },
  });
  return { sender, reached };
}

// The agent marked frozen by a freeze whose cancel of the fill the queue's take beat: the fill
// goes on, and only the signer's read of its rule now stands in its way.
async function freezeAfterTheTake(bench: ExecutorBench): Promise<void> {
  const settings = await bench.test.stores.agents.get(testAgent, live);
  const atMs = bench.test.clock.now();
  const ledgerId = idSchema("led").parse("led_0190f1c2-3a4b-7c5d-8e6f-0000000000fe");
  const agents = [{ agentId: testAgent, expectedVersion: settings?.agent.version ?? 0 }];
  const entry = { id: ledgerId, atMs, agentId: testAgent, subject: testAgent, kind: "freeze" };
  const write = { atMs, isFrozen: true, agents, isWholeInstall: false, moves: [], orders: [] };
  expectOk(
    await bench.test.stores.intents.freeze({ ...write, ledger: [{ ...entry, data: {} }] }, live),
  );
}

// An intent store that freezes the agent right after the queue moves a fill to `executing`.
function freezingAtTake(bench: () => ExecutorBench) {
  return (store: IntentStore): IntentStore => ({
    ...store,
    transition: async (change: IntentChange, call) => {
      const moved = await store.transition(change, call);
      if (change.state === "executing") {
        await freezeAfterTheTake(bench());
      }
      return moved;
    },
  });
}

// Whether the record is an engine's buy, as a rule's fill is.
function isFill(record: IntentRecord): boolean {
  return record.kind === "buy" && record.proposer === "engine";
}

// An intent store through which the executor reads an engine's buy with a quote other than the
// one it was confirmed with.
function changedQuote(store: IntentStore): IntentStore {
  return {
    ...store,
    get: async (id, call) => {
      const record = await store.get(id, call);
      return record !== undefined && isFill(record)
        ? { ...record, quote: { ...(record.quote as object), priceImpactBps: 1 } }
        : record;
    },
  };
}

// A rule store whose first count of a fill on its rule loses the rule's version to another write.
function firstCountStale(store: WebhookRuleStore): WebhookRuleStore {
  const state = { lost: false };
  return {
    ...store,
    async endAlert(write, call) {
      if (!state.lost && write.outcome === "filled") {
        state.lost = true;
        return err("stale");
      }
      return store.endAlert(write, call);
    },
  };
}

// The stuck rules run at 3 and 6 blocks, and a step every relay refuses is dropped after 9.
const dropLimits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };

function relaysAnswer(bench: ExecutorBench, kind: "refuse" | "accept"): void {
  const script =
    kind === "refuse" ? ({ kind, reason: "insufficient_funds" } as const) : ({ kind } as const);
  bench.network.script("relay-a", script);
  bench.network.script("relay-b", script);
}

// The dropped fill's last transaction lands after all, as a relay that kept it sends it on.
async function landsLate(bench: ExecutorBench, fill: Id<"int">): Promise<void> {
  const sent = await bench.test.stores.transactions.ofIntent(fill, live);
  const last = sent.at(-1);
  relaysAnswer(bench, "accept");
  await bench.network.send({ chain: benchChain, raw: last?.raw ?? "" }, live);
}

const boundTermsSchema = z.looseObject({ termsHash: z.string() });

describe("a live webhook rule's fill as it ends", () => {
  it("counts a dropped fill whose bytes landed late once, turning its alert filled", async () => {
    const bench = await startLiveFills({ limits: dropLimits });
    relaysAnswer(bench, "refuse");
    const created = await activeRule(bench, liveBuy);
    const fill = await filledAlert(bench, created, "buy");
    await driveUntil(bench, fill, { states: ["failed_onchain"] });
    const dropped = await alertsOf(bench, created);

    await landsLate(bench, fill);
    await driveUntil(bench, fill, { states: [], blocks: 6 });
    await flush();
    const landed = await alertsOf(bench, created);
    await driveUntil(bench, fill, { states: [], blocks: 6 });

    expect(dropped).toStrictEqual([
      { outcome: "skipped", reason: "stuck_dropped", intentId: fill },
    ]);
    expect(landed).toStrictEqual([{ outcome: "filled", reason: undefined, intentId: fill }]);
    expect(await fillsOf(bench, created)).toBe(1);
  });

  it("resets its sale's approval to zero once its rule is deleted after the approval", async () => {
    const deleter = atFirstSend();
    const bench = await startLiveFills({ held: heldTokens(), sender: deleter.sender });
    const created = await activeRule(bench, liveSale);
    deleter.arm(async () => {
      const handler = bench.test.engine.handlers["webhookRule/delete"];
      expectOk(await handler(testCall({ rule: created.rule })));
    });

    const sale = await filledAlert(bench, created, "sell");
    await expect(driveUntil(bench, sale, { states: ["failed_onchain"] })).resolves.toBe(
      "failed_onchain",
    );
    await flush();

    const actions = bench.signed.map(({ step }) => step.action);
    expect(actions).toMatchObject([{ kind: "approve" }, { kind: "approve", amount: 0n }]);
    expect(await alertsOf(bench, created)).toStrictEqual([
      { outcome: "skipped", reason: "step_unsent", intentId: sale },
    ]);
    expect(executorNotices(bench)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "notice.approvalReset" })]),
    );
    expect(await fillsOf(bench, created)).toBe(0);
  });

  it("goes on with its sale's swap under its grant after a restart that cut it after the approval", async () => {
    const hang = hangAfterFirstSend();
    const bench = await startLiveFills({ held: heldTokens(), sender: hang.sender });
    const created = await activeRule(bench, liveSale);
    const sale = await filledAlert(bench, created, "sell");
    await hang.reached;
    bench.network.mine();

    const restarted = await restartBench(bench, { liveOrderFills: true });
    await expect(
      driveUntil(bench, sale, { states: ["reconciled", "failed_onchain"] }),
    ).resolves.toBe("reconciled");
    await flush();

    expect(restarted.signed.map(({ step }) => step.action.kind)).toStrictEqual(["call"]);
    expect(await alertsOf(bench, created)).toStrictEqual([
      { outcome: "filled", reason: undefined, intentId: sale },
    ]);
    expect(await fillsOf(bench, created)).toBe(1);
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });

  it("resets its sale's approval after a restart once its grant ran out, and counts nothing", async () => {
    const hang = hangAfterFirstSend();
    const bench = await startLiveFills({ held: heldTokens(), sender: hang.sender });
    const created = await activeRule(bench, liveSale);
    const sale = await filledAlert(bench, created, "sell");
    await hang.reached;
    bench.network.mine();
    await bench.test.clock.advance(61_000);

    const restarted = await restartBench(bench, { liveOrderFills: true });
    await expect(
      driveUntil(bench, sale, { states: ["reconciled", "failed_onchain"] }),
    ).resolves.toBe("failed_onchain");
    await flush();

    const actions = restarted.signed.map(({ step }) => step.action);
    expect(actions).toMatchObject([{ kind: "approve", amount: 0n }]);
    expect(await alertsOf(bench, created)).toStrictEqual([
      { outcome: "skipped", reason: "step_unsent", intentId: sale },
    ]);
    expect(await fillsOf(bench, created)).toBe(0);
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });

  it("ends unsigned, fill_failed, when its stored terms no longer hash to what it was confirmed with", async () => {
    const bench = await startLiveFills({ hold: true, executorIntents: changedQuote });
    const created = await activeRule(bench, liveBuy);
    const fill = await filledAlert(bench, created, "buy");
    const [confirmed] = await liveFillsOf(bench);

    await bench.release();
    await flush();
    const [ended] = await liveFillsOf(bench);

    expect(boundTermsSchema.parse(confirmed?.authorizedBy).termsHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(ended?.state).toBe("cancelled");
    expect(bench.signed).toStrictEqual([]);
    expect(await alertsOf(bench, created)).toMatchObject([
      { outcome: "skipped", reason: "fill_failed", intentId: fill },
    ]);
  });

  it("signs no first step once a freeze came after the queue took it, fill_failed, the rule kept", async () => {
    const holder: { bench?: ExecutorBench } = {};
    const bench = await startLiveFills({
      executorIntents: freezingAtTake(() => holder.bench as ExecutorBench),
    });
    holder.bench = bench;
    const created = await activeRule(bench, liveBuy);

    const fill = await filledAlert(bench, created, "buy");
    await driveUntil(bench, fill, { states: ["cancelled", "failed_onchain", "reconciled"] });
    await flush();

    expect(bench.signed).toStrictEqual([]);
    expect(await alertsOf(bench, created)).toStrictEqual([
      { outcome: "skipped", reason: "fill_failed", intentId: fill },
    ]);
    expect((await bench.test.stores.webhookRules.get(created.rule, live))?.state).toBe("active");
  });

  it("finishes a sale whose agent a freeze paused after its approval, and counts it", async () => {
    const freezer = atFirstSend();
    const bench = await startLiveFills({ held: heldTokens(), sender: freezer.sender });
    const created = await activeRule(bench, liveSale);
    freezer.arm(async () => freezeAfterTheTake(bench));

    const sale = await filledAlert(bench, created, "sell");
    await expect(driveUntil(bench, sale, { states: ["reconciled"] })).resolves.toBe("reconciled");
    await flush();

    expect(bench.signed.map(({ step }) => step.action.kind)).toStrictEqual(["approve", "call"]);
    expect(await fillsOf(bench, created)).toBe(1);
  });

  it("counts an unvalued fill again on a fresh read when its first count lost the rule's version", async () => {
    const silent = silentTransfers();
    const bench = await startLiveFills({
      receipts: silent.wrap,
      limits: { settleAfterBlocks: 3 },
      webhookRules: firstCountStale,
    });
    const created = await activeRule(bench, liveBuy);
    const fill = await filledAlert(bench, created, "buy");

    await driveUntil(bench, fill, { states: ["finalized"] });
    await driveUntil(bench, fill, { states: [], blocks: 5 });
    await flush();

    expect(await alertsOf(bench, created)).toStrictEqual([
      { outcome: "filled", reason: undefined, intentId: fill },
    ]);
    expect(await fillsOf(bench, created)).toBe(1);
  });
});
