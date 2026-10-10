import type { Signer, TxDraft } from "@binference/chain";
import { fakeDraft } from "@binference/chain/testing";
import { createIdSource, err, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import type { IntentRequest, QuoteView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createStoredIntents, type IntentSnapshot } from "../intents/create-stored-intents.js";
import { planDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testAgent, testCoin, testSwap, testWallet } from "../intents/test-intents.js";
import { recentOutflowsOf } from "../money-path/recent-outflows.js";
import { testAccount, testCall, testChains } from "../operations/test-engine.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { IntentStore, WalletFactsSource } from "../ports.js";
import { intentPlanOf } from "./intent-plan.js";
import { checkForQueue } from "./queue-check.js";
import { signRequestOf } from "./step-request.js";
import { benchChain, type ExecutorBench, startExecutorBench } from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
const chains = testChains();
const fakeChain = expectOk(chains.get(benchChain));
const otherAccount = "fake:2:0x0000000c" as typeof testAccount;

async function tappedSnapshot(
  bench: ExecutorBench,
  request: IntentRequest = testSwap(),
): Promise<IntentSnapshot> {
  const handlers = bench.test.engine.handlers;
  const view = expectOk(await handlers["intent/propose"](testCall(request)));
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

function checkPartsOf(
  bench: ExecutorBench,
  options: { readonly wallets?: readonly Id<"wal">[] } = {},
) {
  const wallets = options.wallets ?? [testWallet];
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

// The facts with the agent's confirmed outflows read from the store, the intent the facts are
// read for left out.
function confirmedOutflows(bench: ExecutorBench): WalletFactsSource {
  const fixed = checkPartsOf(bench).wallets;
  const { clock, stores } = bench.test;
  return {
    ...fixed,
    async facts(query, call) {
      const { agent: agentId, isPaper, intent } = query;
      const outflows = { agentId, isPaper, nowMs: clock.now() };
      const recentOutflows = await recentOutflowsOf(
        stores.intents,
        intent === undefined ? outflows : { ...outflows, exclude: intent },
        call,
      );
      return { ...(await fixed.facts(query, call)), recentOutflows };
    },
  };
}

// The snapshot with the agent's rolling cap at the intent's own value, so any other outflow of
// the day passes it.
function atCap(snapshot: IntentSnapshot): IntentSnapshot {
  const { settings, record } = snapshot;
  const limits = { ...settings.limits, rollingDayUsdMicros: record.valueUsdMicros ?? 0n };
  return { ...snapshot, settings: { ...settings, limits } };
}

// Custody that holds no account of `missing`, and the others as `custody` does.
function withoutWallet(custody: Signer, missing: Id<"wal">): Signer {
  return {
    ...custody,
    account: async (wallet, chain, call) =>
      wallet === missing ? err("unknown_wallet") : custody.account(wallet, chain, call),
  };
}

// The quote the owner confirmed for the intent.
function quoteOf(snapshot: IntentSnapshot): QuoteView {
  const { quote } = snapshot.record;
  if (quote === undefined) {
    throw new Error("Expected the tapped intent's quote.");
  }
  return quoteDocument.decode(quote);
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
    const parts = checkPartsOf(bench, { wallets: [] });
    const check = await checkForQueue(auto, { parts, chain: fakeChain }, live().signal);
    expect([
      check.facts.hasPolicyPassed,
      check.facts.isAuthorizationValid,
      check.terms,
    ]).toStrictEqual([false, false, undefined]);
  });

  it("judges the intent on its own wallet after the agent's default wallet changed", async () => {
    const bench = await startExecutorBench({ hold: true });
    const { wallet: _wallet, ...onDefault } = testSwap();
    const snapshot = await tappedSnapshot(bench, onDefault);
    const newDefault = fixtureId("wal", 9);
    const parts = {
      ...checkPartsOf(bench, { wallets: [newDefault, testWallet] }),
      custody: withoutWallet(bench.test.custody, newDefault),
    };
    const check = await checkForQueue(snapshot, { parts, chain: fakeChain }, live().signal);
    expect(check.facts.hasPolicyPassed).toBe(true);
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

  it("checks the cap again with the intent's own confirmation left out of the day's", async () => {
    const bench = await startExecutorBench({ hold: true });
    const first = atCap(await tappedSnapshot(bench));
    const parts = { ...checkPartsOf(bench), wallets: confirmedOutflows(bench) };
    const check = async () => checkForQueue(first, { parts, chain: fakeChain }, live().signal);
    expect(first.record.valueUsdMicros).toBeGreaterThan(0n);
    expect((await check()).facts.hasPolicyPassed).toBe(true);
    await tappedSnapshot(bench);
    expect((await check()).facts.hasPolicyPassed).toBe(false);
  });

  it("fails the policy once a venue of the confirmed route is no longer allowed", async () => {
    const bench = await startExecutorBench({ hold: true });
    const snapshot = await tappedSnapshot(bench);
    const parts = checkPartsOf(bench);
    const check = async (venues: readonly string[]) => {
      const limits = { ...snapshot.settings.limits, venues };
      const settings = { ...snapshot.settings, limits };
      return checkForQueue({ ...snapshot, settings }, { parts, chain: fakeChain }, live().signal);
    };
    const routed = quoteOf(snapshot).route.map((leg) => leg.venue);
    expect((await check(["elsewhere", ...routed])).facts.hasPolicyPassed).toBe(true);
    expect((await check(["elsewhere"])).facts.hasPolicyPassed).toBe(false);
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
