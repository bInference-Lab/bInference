import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { createFakeLaunchpad, createFakeVenue, fakeLaunchCallAbi } from "@binference/chain/testing";
import { bpsSchema, err, idSchema, type JsonValue } from "@binference/core";
import type { LimitChanges } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { WalletRecord } from "../install/install-record.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  expectOk,
  testAgent,
  testLimits,
  testNowMs,
  testSwap,
  testToken,
} from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testChains,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { AgentStore } from "../ports.js";
import { testLaunchesOnlyVenue } from "../venues/test-launches-only-venue.js";

const live = { signal: new AbortController().signal };
// The Mini App holds `confirm` and `loosen`; these callers hold one of the two.
const braking: EngineCaller = {
  credential: "tg:7012345678",
  client: { kind: "mini", version: "test" },
  scopes: ["read", "confirm"],
};
const loosening: EngineCaller = { ...braking, scopes: ["read", "loosen"] };
const effectiveAt = testNowMs + looseningWaitMs;
const lower = testLimits.perTradeUsdMicros / 2n;
const higher = testLimits.perTradeUsdMicros * 2n;
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - looseningWaitMs,
});
// The fake chain's one venue contract, as a Privy policy spells an address in a condition.
const swapCeiling = [{ conditions: [{ field: "to", operator: "in", value: ["0x0000000B"] }] }];

function setLimits(test: TestEngine, changes: LimitChanges, caller = testCallers.cli) {
  return test.engine.handlers["limit/set"](testCall({ agent: testAgent, changes }, caller));
}

async function getLimits(test: TestEngine) {
  return expectOk(await test.engine.handlers["limit/get"](testCall({ agent: testAgent })));
}

function cancelPending(test: TestEngine, caller = testCallers.cli) {
  return test.engine.handlers["limit/cancelPending"](testCall({ agent: testAgent }, caller));
}

function notices(test: TestEngine): readonly unknown[] {
  return test.pushes.filter((push) => push.topic === "notice").map((push) => push.data);
}

function changeNotice(limit: string, when?: number) {
  return {
    key: "notice.limitChange",
    agent: testAgent,
    values: { surface: "mini", limit, pending: when === undefined ? "no" : "yes" },
    ...(when === undefined ? {} : { times: { when } }),
  };
}

async function proposedState(test: TestEngine): Promise<string> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(testSwap()));
  return expectOk(proposed).state;
}

// An agent store whose limit writes another write beats `times` times first.
function staleLimits(times: number): (store: AgentStore) => AgentStore {
  const left = { times };
  return (store) => ({
    ...store,
    async setLimits(change, options) {
      if (left.times === 0) {
        return store.setLimits(change, options);
      }
      left.times -= 1;
      return err("stale");
    },
  });
}

async function withWallet(ceiling: WalletRecord["ceiling"]["policy"]): Promise<TestEngine> {
  const test = await startTestEngine({ agent: { limits: { ...testLimits, venues: [] } } });
  test.stores.install.addWallet({ ...wallet, ceiling: { ...wallet.ceiling, policy: ceiling } });
  return test;
}

// An agent in the mode, beside a launchpad whose every launch has a curve of its own (decision
// 0212), with a live wallet whose ceiling names no contract.
async function besideLaunchCurves(mode: "paper" | "live"): Promise<TestEngine> {
  const launchCurve = accountRefSchema.parse("fake:1:0x000000c1");
  const test = await startTestEngine({
    chains: testChains(["fake-curve"]),
    venues: [createFakeVenue(), createFakeLaunchpad({ onCurve: [], launchCurve })],
    agent: { mode, limits: { ...testLimits, venues: [] } },
  });
  test.stores.install.addWallet({ ...wallet, ceiling: { ...wallet.ceiling, policy: [] } });
  return test;
}

// An agent in the mode, beside a launchpad that only launches tokens (decision 0282), with a live
// wallet whose ceiling names no contract.
async function besideLaunchesOnly(mode: "paper" | "live"): Promise<TestEngine> {
  const test = await startTestEngine({
    chains: testChains(["fake-curve"]),
    venues: [createFakeVenue(), testLaunchesOnlyVenue()],
    agent: { mode, limits: { ...testLimits, venues: [] } },
  });
  test.stores.install.addWallet({ ...wallet, ceiling: { ...wallet.ceiling, policy: [] } });
  return test;
}

// The agent's launch wallet, whose stored ceiling holds the policy given.
function launchWalletWith(policy: JsonValue): WalletRecord {
  return {
    ...wallet,
    id: fixtureId("wal", 77),
    custodyWalletId: "privy-wallet-launch",
    address: "0x000000d7",
    role: "launch",
    ceiling: { ...wallet.ceiling, policy },
  };
}

describe("the limits operation", () => {
  it("answers the agent's limits with the gas reserve per chain", async () => {
    const test = await startTestEngine();

    expect(await getLimits(test)).toStrictEqual({
      agent: testAgent,
      perTradeUsdMicros: testLimits.perTradeUsdMicros,
      rollingDayUsdMicros: testLimits.rollingDayUsdMicros,
      slippageRegistryBps: testLimits.slippageRegistryBps,
      slippageOtherBps: testLimits.slippageOtherBps,
      priceImpactBps: testLimits.priceImpactBps,
      taxBps: testLimits.taxBps,
      liquidityFloorUsdMicros: testLimits.liquidityFloorUsdMicros,
      minHealthFactorBps: 15_000,
      gasReserve: { "fake:1": 10n ** 15n },
      venues: ["fake-swap"],
      allowTokens: [],
      denyTokens: [],
      modelBudgetUsdMicros: testLimits.modelBudgetUsdMicros,
      cardTradeExpirySeconds: 60,
      cardOtherExpirySeconds: 600,
      requoteAfterSeconds: 10,
      requoteToleranceBps: testLimits.requoteToleranceBps,
      orderExpiryDays: 30,
      copyPerBuyUsdMicros: testLimits.copyPerBuyUsdMicros,
      copyPerLeaderDayUsdMicros: testLimits.copyPerLeaderDayUsdMicros,
      changedAt: testNowMs - 1_000,
    });
  });

  it("refuses an unknown agent", async () => {
    const test = await startTestEngine();
    const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");

    expect(await test.engine.handlers["limit/get"](testCall({ agent }))).toStrictEqual(
      err("agent.not_found"),
    );
  });
});

describe("a stricter limit", () => {
  it("applies at once with the confirm scope, journaled and announced", async () => {
    const test = await startTestEngine();

    const set = expectOk(await setLimits(test, { perTradeUsdMicros: lower }, braking));

    expect([set.perTradeUsdMicros, set.pending]).toStrictEqual([lower, undefined]);
    expect(notices(test)).toStrictEqual([changeNotice("perTradeUsdMicros")]);
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(entries).toMatchObject([
      {
        by: braking.credential,
        surface: "mini",
        path: "agents.main.limits",
        before: { perTradeUsdMicros: testLimits.perTradeUsdMicros.toString() },
        after: { perTradeUsdMicros: lower.toString() },
      },
    ]);
  });

  it("keeps a denied token in its canonical form, once, and refuses one without", async () => {
    const test = await startTestEngine();
    const shouted = assetRefSchema.parse("fake:1/token:0x0000000A");

    const set = expectOk(await setLimits(test, { denyTokens: [shouted, testToken] }, braking));

    expect(set.denyTokens).toStrictEqual([testToken]);
    expect(await proposedState(test)).toBe("rejected_policy");
    const malformed = assetRefSchema.parse("fake:1/token:0x0a");
    expect(await setLimits(test, { denyTokens: [malformed] }, braking)).toStrictEqual(
      err("protocol.bad_args"),
    );
  });

  it("takes the health factor, card expiries and re-quote wait by their protocol names", async () => {
    const test = await startTestEngine();
    const changes = {
      minHealthFactorBps: 16_000,
      cardTradeExpirySeconds: 30,
      cardOtherExpirySeconds: 300,
      requoteAfterSeconds: 5,
    };

    const set = expectOk(await setLimits(test, changes, braking));

    expect(set).toMatchObject(changes);
    expect(set.pending).toBeUndefined();
    expect(await getLimits(test)).toMatchObject(changes);
  });

  it("changes a gas reserve only on the chain it names", async () => {
    const test = await startTestEngine();

    const gasReserve = Object.fromEntries([["fake:1", 10n ** 16n]]);
    const set = expectOk(await setLimits(test, { gasReserve }, braking));

    expect(set.gasReserve).toStrictEqual({ "fake:1": 10n ** 16n });
    expect(notices(test)).toStrictEqual([changeNotice("gasReserve")]);
  });
});

describe("a limit write another write beats", () => {
  it("reads the limits again and applies the change", async () => {
    const test = await startTestEngine({ agents: staleLimits(2) });

    const set = expectOk(await setLimits(test, { perTradeUsdMicros: lower }, braking));

    expect(set.perTradeUsdMicros).toBe(lower);
    expect((await getLimits(test)).perTradeUsdMicros).toBe(lower);
  });

  it("gives up once every attempt lost, and keeps the limits", async () => {
    const test = await startTestEngine({ agents: staleLimits(1_000) });

    await expect(setLimits(test, { perTradeUsdMicros: lower }, braking)).rejects.toMatchObject({
      code: "engine.agent_stale",
    });
    expect((await getLimits(test)).perTradeUsdMicros).toBe(testLimits.perTradeUsdMicros);
    expect(notices(test)).toStrictEqual([]);
  });
});

describe("a looser limit", () => {
  it("needs the loosen scope, and waits 24 hours announced with that time", async () => {
    const test = await startTestEngine();

    expect(await setLimits(test, { perTradeUsdMicros: higher }, braking)).toStrictEqual(
      err("auth.scope"),
    );
    expect(test.pushes).toStrictEqual([]);
    const set = expectOk(await setLimits(test, { perTradeUsdMicros: higher }, loosening));

    const pending = { changes: { perTradeUsdMicros: higher }, effectiveAt };
    expect([set.perTradeUsdMicros, set.pending]).toStrictEqual([
      testLimits.perTradeUsdMicros,
      pending,
    ]);
    expect(notices(test)).toStrictEqual([changeNotice("perTradeUsdMicros", effectiveAt)]);
    await test.clock.advance(looseningWaitMs - 1);
    expect((await getLimits(test)).pending).toStrictEqual(pending);
    await test.clock.advance(1);
    const applied = await getLimits(test);
    expect([applied.perTradeUsdMicros, applied.pending]).toStrictEqual([higher, undefined]);
  });

  it("holds every trade to the limit in effect until its time", async () => {
    const limits = { ...testLimits, perTradeUsdMicros: 0n };
    const test = await startTestEngine({ agent: { limits } });
    expectOk(await setLimits(test, { perTradeUsdMicros: testLimits.perTradeUsdMicros }));

    await test.clock.advance(looseningWaitMs - 1);
    expect(await proposedState(test)).toBe("rejected_policy");
    await test.clock.advance(1);
    expect(await proposedState(test)).toBe("awaiting_confirmation");
  });

  it("treats an empty allow list as allowing every token, so looser", async () => {
    const test = await startTestEngine({
      agent: { limits: { ...testLimits, allowTokens: [testToken] } },
    });

    expect(await setLimits(test, { allowTokens: [] }, braking)).toStrictEqual(err("auth.scope"));
  });

  it("is cancelled with the confirm scope, announced, and the limit stays", async () => {
    const test = await startTestEngine();
    expectOk(await setLimits(test, { perTradeUsdMicros: higher }));

    const cancelled = expectOk(await cancelPending(test, braking));

    expect(cancelled.pending).toBeUndefined();
    expect(notices(test).at(-1)).toStrictEqual({
      key: "notice.limitChangeCancelled",
      agent: testAgent,
      values: { limit: "perTradeUsdMicros" },
    });
    await test.clock.advance(looseningWaitMs);
    expect((await getLimits(test)).perTradeUsdMicros).toBe(testLimits.perTradeUsdMicros);
  });

  it("is dropped by asking for the value in effect, and the others keep their time", async () => {
    const test = await startTestEngine();
    expectOk(await setLimits(test, { perTradeUsdMicros: higher, taxBps: bpsSchema.parse(9_000) }));
    await test.clock.advance(60_000);

    const back = { perTradeUsdMicros: testLimits.perTradeUsdMicros };
    const set = expectOk(await setLimits(test, back, braking));

    expect(set.pending).toStrictEqual({ changes: { taxBps: 9_000 }, effectiveAt });
    expect(notices(test).slice(2)).toStrictEqual([
      {
        key: "notice.limitChangeCancelled",
        agent: testAgent,
        values: { limit: "perTradeUsdMicros" },
      },
    ]);
  });

  it("changes nothing for the limits in effect or a cancel with nothing waiting", async () => {
    const test = await startTestEngine();

    expectOk(await setLimits(test, { taxBps: testLimits.taxBps }, braking));
    expectOk(await cancelPending(test, braking));
    expect(test.pushes).toStrictEqual([]);
  });
});

describe("a venue added to the limits", () => {
  it("is over the ceiling while a live wallet's ceiling leaves its contracts out", async () => {
    const test = await withWallet([]);

    expect(await setLimits(test, { venues: ["fake-swap"] })).toStrictEqual(
      err("limit.over_ceiling"),
    );
    expect(test.pushes).toStrictEqual([]);
  });

  it("waits 24 hours like any loosening once every ceiling names its contracts", async () => {
    const test = await withWallet(swapCeiling);

    const set = expectOk(await setLimits(test, { venues: ["fake-swap"] }));

    expect(set.pending).toStrictEqual({ changes: { venues: ["fake-swap"] }, effectiveAt });
  });

  it("needs no ceiling for a paper agent when it trades on a launch's own contracts", async () => {
    const test = await besideLaunchCurves("paper");

    const set = expectOk(await setLimits(test, { venues: ["fake-curve"] }));

    expect(set.pending).toStrictEqual({ changes: { venues: ["fake-curve"] }, effectiveAt });
  });

  it("needs a launch wallet for a live agent when it trades on a launch's own contracts", async () => {
    const test = await besideLaunchCurves("live");

    expect(await setLimits(test, { venues: ["fake-curve"] })).toStrictEqual(
      err("limit.needs_launch_wallet"),
    );
    expect(await setLimits(test, { venues: ["fake-swap"] })).toStrictEqual(
      err("limit.over_ceiling"),
    );
  });

  it("lets a live agent with a launch wallet add a launchpad, after the 24-hour wait", async () => {
    const test = await besideLaunchCurves("live");
    test.stores.install.addWallet(launchWalletWith([{ abi: [fakeLaunchCallAbi] }]));

    const set = expectOk(await setLimits(test, { venues: ["fake-curve"] }));

    expect(set.pending).toStrictEqual({ changes: { venues: ["fake-curve"] }, effectiveAt });
  });

  it("refuses a launchpad whose launch calls the launch wallet's ceiling lacks", async () => {
    const test = await besideLaunchCurves("live");
    test.stores.install.addWallet(launchWalletWith([]));

    expect(await setLimits(test, { venues: ["fake-curve"] })).toStrictEqual(
      err("limit.over_ceiling"),
    );
  });

  it("needs a launch wallet, not a main wallet's ceiling, when it only launches tokens", async () => {
    const test = await besideLaunchesOnly("live");
    expect(await setLimits(test, { venues: ["fake-curve"] })).toStrictEqual(
      err("limit.needs_launch_wallet"),
    );
    test.stores.install.addWallet(launchWalletWith([]));
    const set = expectOk(await setLimits(test, { venues: ["fake-curve"] }));
    expect(set.pending).toStrictEqual({ changes: { venues: ["fake-curve"] }, effectiveAt });
  });

  it("needs no ceiling for a paper agent when it only launches tokens", async () => {
    const test = await besideLaunchesOnly("paper");
    expect(expectOk(await setLimits(test, { venues: ["fake-curve"] })).pending).toStrictEqual({
      changes: { venues: ["fake-curve"] },
      effectiveAt,
    });
  });

  it("is malformed when the registry holds no contract of it, as is an unknown chain", async () => {
    const test = await withWallet(swapCeiling);

    expect(
      await Promise.all([
        setLimits(test, { venues: ["no-such-swap"] }),
        setLimits(test, { gasReserve: Object.fromEntries([["fake:9", 1n]]) }),
      ]),
    ).toStrictEqual([err("protocol.bad_args"), err("protocol.bad_args")]);
  });
});
