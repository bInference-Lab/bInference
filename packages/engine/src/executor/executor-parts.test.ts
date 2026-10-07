import type { TxDraft } from "@binference/chain";
import { fakeDraft } from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createStoredIntents, type IntentSnapshot } from "../intents/create-stored-intents.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testAgent, testCoin, testSwap, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall, testChains } from "../operations/test-engine.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { IntentStore } from "../ports.js";
import { intentPlanOf } from "./intent-plan.js";
import { checkForQueue } from "./queue-check.js";
import { signRequestOf } from "./step-request.js";
import { benchChain, type ExecutorBench, startExecutorBench } from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
const chains = testChains();
const fakeChain = expectOk(chains.get(benchChain));
const otherAccount = "fake:2:0x0000000c" as typeof testAccount;

async function tappedSnapshot(bench: ExecutorBench): Promise<IntentSnapshot> {
  const handlers = bench.test.engine.handlers;
  const view = expectOk(await handlers["intent/propose"](testCall(testSwap())));
  const card = view.card?.card as Id<"crd">;
  expectOk(
    await handlers["intent/confirm"](testCall({ intent: view.intent, card, cardVersion: 1 })),
  );
  const stored = createStoredIntents({
    intents: bench.test.stores.intents,
    agents: bench.test.stores.agents,
    ids: createIdSource({ clock: bench.test.clock, random: createSeededRandom(2) }),
    publish: () => undefined,
  });
  const snapshot = await stored.snapshot(view.intent, live());
  if (snapshot === undefined) {
    throw new Error("Expected the tapped intent to be stored.");
  }
  return snapshot;
}

function checkPartsOf(bench: ExecutorBench, options: { readonly wallets?: boolean } = {}) {
  const wallets = options.wallets === false ? [] : [testWallet];
  return {
    custody: bench.test.custody,
    wallets: createFakeWalletFacts(new Map([[testAgent, wallets]]), {
      nativeBalanceBase: 10n ** 18n,
      ceilingPerTxNativeBase: 10n ** 18n,
      feePerGasNativeBase: 50_000_000n,
      networkFeeCapNativeBase: 1_000_000_000n,
      recentOutflows: [],
    }),
    chains,
    intents: bench.test.stores.intents,
    policy: createPolicyCheck({
      prices: createFakePriceSource(
        new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]),
      ),
      clock: bench.test.clock,
    }),
    clock: bench.test.clock,
  };
}

function withStatus(
  snapshot: IntentSnapshot,
  authorizedBy: NonNullable<IntentSnapshot["stored"]["status"]["authorizedBy"]>,
): IntentSnapshot {
  const status = { ...snapshot.stored.status, authorizedBy };
  return { ...snapshot, stored: { ...snapshot.stored, status } };
}

function draft(account: typeof testAccount): TxDraft {
  return fakeDraft(account, { to: "0x0000000b", value: 0n, data: "swap" });
}

function recordWith(plan: readonly TxDraft[] | undefined): IntentRecord {
  return (plan === undefined ? {} : { plan: planDocument.encode(plan) }) as IntentRecord;
}

describe("an intent's plan", () => {
  const sending = new Map([[benchChain, {} as never]]);

  it.each([
    ["no_plan", undefined],
    ["chains_differ", [draft(testAccount), draft(otherAccount)]],
    ["unknown_chain", [draft(otherAccount)]],
  ] as const)("is %s for a plan the executor cannot run", (problem, plan) => {
    expect(intentPlanOf(recordWith(plan), { chains, sending })).toStrictEqual({ problem });
  });

  it("refuses a step its chain's family cannot read", () => {
    const unreadable = { chain: benchChain, from: testAccount, payload: "not a call" };
    const step = {
      record: { id: fixtureId("int", 1) } as never,
      chain: fakeChain,
      terms: {} as never,
      index: 0,
      draft: unreadable,
      unsigned: unreadable,
    };
    expect(() => signRequestOf(step)).toThrow(expect.objectContaining({ code: "engine.bad_plan" }));
  });
});

describe("the queue check", () => {
  it("authorizes no fill, whose order the executor cannot read yet", async () => {
    const bench = await startExecutorBench({ hold: true });
    const snapshot = withStatus(await tappedSnapshot(bench), { order: fixtureId("ord", 1) });
    const check = await checkForQueue(
      snapshot,
      { parts: checkPartsOf(bench), chain: fakeChain },
      live().signal,
    );
    expect([check.terms, check.isAuto, check.facts.isAuthorizationValid]).toStrictEqual([
      undefined,
      false,
      false,
    ]);
  });

  it("fails the policy and the auto grant when the wallet no longer resolves", async () => {
    const bench = await startExecutorBench({ hold: true });
    const auto = withStatus(await tappedSnapshot(bench), { approvalMode: "auto", modeVersion: 0 });
    const parts = checkPartsOf(bench, { wallets: false });
    const check = await checkForQueue(auto, { parts, chain: fakeChain }, live().signal);
    expect([
      check.facts.hasPolicyPassed,
      check.facts.isAuthorizationValid,
      check.terms,
    ]).toStrictEqual([false, false, undefined]);
  });

  it("has no terms for a tapped intent whose confirmation is not stored", async () => {
    const bench = await startExecutorBench({ hold: true });
    const snapshot = await tappedSnapshot(bench);
    const intents: IntentStore = {
      ...bench.test.stores.intents,
      confirmation: async () => Promise.resolve(undefined),
    };
    const parts = { ...checkPartsOf(bench), intents };
    const check = await checkForQueue(snapshot, { parts, chain: fakeChain }, live().signal);
    expect(check.terms).toBeUndefined();
  });

  it("fails the policy for an intent with no quote", async () => {
    const bench = await startExecutorBench({ hold: true });
    const snapshot = await tappedSnapshot(bench);
    const { quote: _quote, ...record } = snapshot.record;
    const check = await checkForQueue(
      { ...snapshot, record },
      { parts: checkPartsOf(bench), chain: fakeChain },
      live().signal,
    );
    expect(check.facts.hasPolicyPassed).toBe(false);
  });
});
