import { bpsSchema, err, idSchema } from "@binference/core";
import type { LimitChanges } from "@binference/protocol";
import { describe, expect, it } from "vitest";
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
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";

const live = { signal: new AbortController().signal };
// The Mini App holds `confirm` and `loosen`; these callers hold one of the two.
const braking: EngineCaller = {
  credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
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

async function withWallet(ceiling: WalletRecord["ceiling"]["policy"]): Promise<TestEngine> {
  const test = await startTestEngine({ agent: { limits: { ...testLimits, venues: [] } } });
  test.stores.install.addWallet({ ...wallet, ceiling: { ...wallet.ceiling, policy: ceiling } });
  return test;
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

  it("changes a gas reserve only on the chain it names", async () => {
    const test = await startTestEngine();

    const gasReserve = Object.fromEntries([["fake:1", 10n ** 16n]]);
    const set = expectOk(await setLimits(test, { gasReserve }, braking));

    expect(set.gasReserve).toStrictEqual({ "fake:1": 10n ** 16n });
    expect(notices(test)).toStrictEqual([changeNotice("gasReserve")]);
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
