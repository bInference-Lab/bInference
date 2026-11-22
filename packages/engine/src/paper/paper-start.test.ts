import type { AssetRef, UsdPrice } from "@binference/chain";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  expectOk,
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import {
  listedArchived,
  startTestEngine,
  type TestEngine,
  testCall,
  testFacts,
} from "../operations/test-engine.js";
import type { PositionStore } from "../ports.js";
import { createPositions } from "../positions/create-positions.js";
import { createPaperPortfolio } from "./paper-portfolio.js";
import { createPaperStart } from "./paper-start.js";

const live = { signal: new AbortController().signal };
const coinPrice: UsdPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };
const oldWallet: Id<"wal"> = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const nothingStarted = { started: [], waiting: [] };

async function paperHeld(
  store: PositionStore,
  walletId: Id<"wal"> = testWallet,
): Promise<readonly (readonly [AssetRef, bigint])[]> {
  const held = await store.positions({ walletId, isPaper: true }, live);
  return held.map((position) => [position.asset, position.quantityBase] as const);
}

async function arrivalCount(store: PositionStore): Promise<number> {
  return (await store.arrivals({ after: 0, limit: 10, isPaper: true }, live)).length;
}

// Proposes the test swap and confirms its card.
async function swapped(test: TestEngine) {
  const { handlers } = test.engine;
  const view = expectOk(await handlers["intent/propose"](testCall(testSwap())));
  const card = idSchema("crd").parse(view.card?.card);
  return expectOk(
    await handlers["intent/confirm"](testCall({ intent: view.intent, card, cardVersion: 1 })),
  );
}

/** The paper start over memory stores, with the prices and the agent's wallets a test sets. */
async function startOver(options: {
  readonly prices: Map<AssetRef, UsdPrice>;
  readonly wallets: Map<Id<"agt">, readonly Id<"wal">[]>;
  readonly store?: PositionStore;
}) {
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft(), live);
  const store = options.store ?? createMemoryPositionStore();
  const prices = createFakePriceSource(options.prices);
  const wallets = createFakeWalletFacts(options.wallets, testFacts);
  const portfolio = createPaperPortfolio({
    positions: createPositions({ store, prices }),
    store,
    wallets,
    clock: createManualClock(testNowMs),
    startingBalances: [{ asset: testCoin, base: 10n ** 18n }],
  });
  const start = createPaperStart({ ...stores, positions: store, portfolio, wallets });
  return { start, store, stores };
}

// A position store whose arrival reads fail, as a library's fault would, until `heal`.
function arrivalsFailing(inner: PositionStore) {
  const state = { isFailing: true };
  const store: PositionStore = {
    ...inner,
    arrivals: async (query, call) =>
      state.isFailing ? Promise.reject(new TypeError("disk gone")) : inner.arrivals(query, call),
  };
  return { store, heal: () => (state.isFailing = false) };
}

describe("the paper start", () => {
  it("opens the starting balances once for an agent that never had a paper portfolio", async () => {
    const test = await startTestEngine({ paper: [] });
    expect(await paperHeld(test.positions)).toStrictEqual([]);

    expect(await test.engine.startPaper(live)).toStrictEqual({ started: [testAgent], waiting: [] });
    expect(await test.engine.startPaper(live)).toStrictEqual(nothingStarted);

    expect(await paperHeld(test.positions)).toStrictEqual([[testCoin, 10n ** 18n]]);
    expect(await arrivalCount(test.positions)).toBe(1);
  });

  it("lets the agent fill a paper swap from its start, and leaves what it traded", async () => {
    const test = await startTestEngine({ paper: [] });
    await test.engine.startPaper(live);

    const view = await swapped(test);

    expect([view.state, view.paper]).toStrictEqual(["paper_filled", true]);
    const traded = [
      [testCoin, 10n ** 18n - 1_000_000n],
      [testToken, 2_000_000n],
    ];
    expect(await paperHeld(test.positions)).toStrictEqual(traded);
    expect(await test.restart().startPaper(live)).toStrictEqual(nothingStarted);
    expect(await paperHeld(test.positions)).toStrictEqual(traded);
    expect(await arrivalCount(test.positions)).toBe(1);
  });

  it("leaves an agent alone whose paper portfolio the owner started", async () => {
    const test = await startTestEngine();
    const before = await paperHeld(test.positions);

    expect(await test.engine.startPaper(live)).toStrictEqual(nothingStarted);

    expect(await paperHeld(test.positions)).toStrictEqual(before);
    expect(await arrivalCount(test.positions)).toBe(1);
  });

  it("leaves an agent alone whose paper records sit on a wallet it no longer uses", async () => {
    const test = await startTestEngine({ paper: [] });
    const record = testWalletRecord({
      id: oldWallet,
      agentId: testAgent,
      label: "old",
      createdAtMs: testNowMs,
    });
    test.stores.install.addWallet({ ...record, archivedAtMs: testNowMs });
    const received = { asset: testCoin, base: 5n };
    const arrival = { walletId: oldWallet, isPaper: true, atMs: testNowMs, received };
    await test.positions.recordArrival({ arrival, positions: [] }, live);

    expect(await test.engine.startPaper(live)).toStrictEqual(nothingStarted);

    expect(await paperHeld(test.positions)).toStrictEqual([]);
  });

  it("starts a live agent's paper portfolio too, and no archived agent's", async () => {
    const liveAgent = await startTestEngine({ paper: [], agent: { mode: "live" } });
    expect(await liveAgent.engine.startPaper(live)).toStrictEqual({
      started: [testAgent],
      waiting: [],
    });

    const archived = await startTestEngine({ paper: [], agents: listedArchived });
    expect(await archived.engine.startPaper(live)).toStrictEqual(nothingStarted);
    expect(await paperHeld(archived.positions)).toStrictEqual([]);
  });

  it("waits for an agent with no wallet, and starts it once it has one", async () => {
    const wallets = new Map<Id<"agt">, readonly Id<"wal">[]>();
    const { start, store } = await startOver({ prices: new Map([[testCoin, coinPrice]]), wallets });

    expect(await start(live)).toStrictEqual({ started: [], waiting: [testAgent] });

    wallets.set(testAgent, [testWallet]);
    expect(await start(live)).toStrictEqual({ started: [testAgent], waiting: [] });
    expect(await paperHeld(store)).toStrictEqual([[testCoin, 10n ** 18n]]);
  });

  it("counts a lost race as a paper portfolio another write started, and writes nothing", async () => {
    const inner = createMemoryPositionStore();
    const losing: PositionStore = {
      ...inner,
      resetPaper: async () => Promise.resolve({ ok: false, error: "stale" }),
    };
    const { start } = await startOver({
      prices: new Map([[testCoin, coinPrice]]),
      wallets: new Map([[testAgent, [testWallet]]]),
      store: losing,
    });

    expect(await start(live)).toStrictEqual(nothingStarted);
    expect(await start(live)).toStrictEqual(nothingStarted);
    expect(await arrivalCount(inner)).toBe(0);
  });

  it("throws a read that fails, and starts the agent on the next pass", async () => {
    const reads = arrivalsFailing(createMemoryPositionStore());
    const { start } = await startOver({
      prices: new Map([[testCoin, coinPrice]]),
      wallets: new Map([[testAgent, [testWallet]]]),
      store: reads.store,
    });

    await expect(start(live)).rejects.toMatchObject({ code: "paper.start_failed" });

    reads.heal();
    expect(await start(live)).toStrictEqual({ started: [testAgent], waiting: [] });
  });

  it("throws a read's own error as it is", async () => {
    const inner = createMemoryPositionStore();
    const fault = new BinferenceError({ code: "store.unavailable", message: "Gone." });
    const store: PositionStore = {
      ...inner,
      executions: async () => Promise.reject(fault),
    };
    const { start } = await startOver({
      prices: new Map([[testCoin, coinPrice]]),
      wallets: new Map([[testAgent, [testWallet]]]),
      store,
    });

    await expect(start(live)).rejects.toBe(fault);
  });
});
