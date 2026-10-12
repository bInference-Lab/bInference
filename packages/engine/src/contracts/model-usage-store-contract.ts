import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ModelCharge } from "../billing/model-charge.js";
import type { ModelUsageStore } from "../billing/ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh usage store that holds agents 1 and 2 of the fixtures, and no usage. */
export interface ModelUsageStoreHarness {
  create(): Promise<ModelUsageStore>;
}

const first = fixtureId("agt", 1);
const second = fixtureId("agt", 2);
const turn = fixtureId("trn", 1);
const dayMs = 86_400_000;
const dayAtMs = 1_800_000_000_000;

function attempt(n: number, change: Partial<ModelCharge> = {}): ModelCharge {
  return {
    agent: first,
    turn,
    key: `${turn}.usage.${String(n)}`,
    model: "anthropic/claude-sonnet-4-6",
    inputTokens: 1_000,
    outputTokens: 100,
    cachedTokens: 0,
    usdMicros: 4_500n,
    atMs: dayAtMs + n,
    ...change,
  };
}

const today = { fromMs: dayAtMs, toMs: dayAtMs + dayMs };

async function sumsByAgentAndModel(store: ModelUsageStore): Promise<void> {
  await store.record(attempt(1), live());
  await store.record(attempt(2, { inputTokens: 9, outputTokens: 1, cachedTokens: 8 }), live());
  await store.record(attempt(3, { model: "openai/gpt-5.4", usdMicros: 2n ** 64n + 1n }), live());
  await store.record(attempt(4, { agent: second, usdMicros: 7n }), live());
  assert.deepEqual(await store.spent(today, live()), [
    {
      agent: first,
      model: "anthropic/claude-sonnet-4-6",
      inputTokens: 1_009,
      outputTokens: 101,
      cachedTokens: 8,
      usdMicros: 9_000n,
    },
    {
      agent: first,
      model: "openai/gpt-5.4",
      inputTokens: 1_000,
      outputTokens: 100,
      cachedTokens: 0,
      usdMicros: 2n ** 64n + 1n,
    },
    {
      agent: second,
      model: "anthropic/claude-sonnet-4-6",
      inputTokens: 1_000,
      outputTokens: 100,
      cachedTokens: 0,
      usdMicros: 7n,
    },
  ]);
  const ofSecond = await store.spent({ ...today, agent: second }, live());
  assert.deepEqual(
    ofSecond.map(({ agent, usdMicros }) => ({ agent, usdMicros })),
    [{ agent: second, usdMicros: 7n }],
  );
}

async function keepsAKeyOnce(store: ModelUsageStore): Promise<void> {
  assert.equal(await store.record(attempt(1), live()), "recorded");
  assert.equal(await store.record(attempt(1, { usdMicros: 9n }), live()), "exists");
  const spent = await store.spent(today, live());
  assert.deepEqual(
    spent.map(({ usdMicros }) => usdMicros),
    [4_500n],
  );
}

async function countsOnlyTheRange(store: ModelUsageStore): Promise<void> {
  await store.record(attempt(1, { atMs: dayAtMs - 1 }), live());
  await store.record(attempt(2, { atMs: dayAtMs }), live());
  await store.record(attempt(3, { atMs: dayAtMs + dayMs - 1 }), live());
  await store.record(attempt(4, { atMs: dayAtMs + dayMs }), live());
  const spent = await store.spent(today, live());
  assert.deepEqual(
    spent.map(({ usdMicros }) => usdMicros),
    [9_000n],
  );
  assert.deepEqual(await store.spent({ fromMs: 0, toMs: 1 }, live()), []);
}

async function claimsANoticeOncePerDay(store: ModelUsageStore): Promise<void> {
  const claim = { agent: first, dayAtMs, atMs: dayAtMs + 5 };
  assert.equal(await store.claimBudgetNotice(claim, live()), true);
  assert.equal(await store.claimBudgetNotice({ ...claim, atMs: dayAtMs + 9 }, live()), false);
  assert.equal(await store.claimBudgetNotice({ ...claim, agent: second }, live()), true);
  assert.equal(await store.claimBudgetNotice({ ...claim, dayAtMs: dayAtMs + dayMs }, live()), true);
}

async function refusesAborted(store: ModelUsageStore): Promise<void> {
  await assertRefusesAborted(async (options) => store.record(attempt(1), options));
  await assertRefusesAborted(async (options) => store.spent(today, options));
  const claim = { agent: first, dayAtMs, atMs: dayAtMs };
  await assertRefusesAborted(async (options) => store.claimBudgetNotice(claim, options));
  assert.deepEqual(await store.spent(today, live()), []);
  assert.equal(await store.claimBudgetNotice(claim, live()), true);
}

/** The contract every `ModelUsageStore` adapter passes. */
export function modelUsageStoreContract(harness: ModelUsageStoreHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn(
      "sums each agent's spend by model, in agent then model order",
      create,
      sumsByAgentAndModel,
    ),
    checkOn("keeps an attempt's key once and the first cost with it", create, keepsAKeyOnce),
    checkOn("counts only the attempts inside the range", create, countsOnlyTheRange),
    checkOn("claims each agent's budget notice once a day", create, claimsANoticeOncePerDay),
    checkOn("refuses every call on an aborted signal and keeps nothing", create, refusesAborted),
  ];
}
