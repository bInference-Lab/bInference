import type { AccountRef, Amount, Signer } from "@binference/chain";
import type { StakePlan, StakingHolding, UnbondingPart } from "@binference/chain/staking";
import { bpsSchema, err, type Id, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { addressPartOf, shortAddress } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { stakeQuoteDocument } from "../intents/stake-quote.js";
import { testAgent, testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import type { ArrivalDraft } from "../positions/arrival-record.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createStakingHost } from "../venues/staking-host.js";
import { liquidChains, testLiquidFake } from "./test-liquid-stakes.js";
import type { UnbondingRecord } from "./unbonding-record.js";
import { type LiquidWatchParts, watchLiquidParts } from "./watch-liquid-parts.js";

const live = { signal: new AbortController().signal };
const pool = testLiquidFake().pool;
const wallet = "fake:1:0x0000000c" as AccountRef;
const coin = (base: bigint): Amount => ({ asset: testCoin, base });

// An open live unbonding of the test wallet on the fake pool, ready a day before now.
function rowOf(n: number, change: Partial<UnbondingRecord> = {}): UnbondingRecord {
  return {
    id: n,
    intentId: fixtureId("int", n),
    walletId: testWallet,
    venue: "fake-liquid",
    validator: pool,
    requestRef: String(n),
    amount: coin(10n ** 17n),
    valueUsdMicros: 60_000_000n,
    readyAtMs: testNowMs - 86_400_000,
    isPaper: false,
    ...change,
  };
}

// The pool's holding of the wallet, listing the parts given.
function holdingOf(parts: readonly UnbondingPart[]): StakingHolding {
  return {
    wallet,
    validator: pool,
    staked: coin(0n),
    stakedValue: coin(0n),
    unbonding: parts,
    claimable: coin(0n),
  };
}

// A live claim's plan of the parts named.
function claimOf(parts: readonly string[]): StakePlan {
  return {
    action: "claim",
    wallet,
    validator: pool,
    validatorName: "Pool",
    commissionBps: bpsSchema.parse(1_000),
    jailed: false,
    paper: false,
    value: coin(0n),
    moved: coin(10n ** 17n),
    parts,
    unbondingSeconds: 604_800,
    plannedAtMs: testNowMs,
  };
}

interface Watched {
  readonly parts: LiquidWatchParts;
  readonly pushes: EnginePush[];
  readonly closed: number[];
  readonly told: number[];
  readonly arrivals: ArrivalDraft[];
}

// The watch over the rows given, a wallet with or without its agent, the pool's holdings as given,
// and the live intents given.
function watchOver(setup: {
  readonly rows: readonly UnbondingRecord[];
  readonly holdings: () => Promise<readonly StakingHolding[]>;
  readonly agentId?: Id<"agt">;
  readonly intents?: readonly IntentRecord[];
  readonly account?: Signer["account"];
}): Watched {
  const venue = { ...testLiquidFake(), holdings: setup.holdings };
  const clock = createManualClock(testNowMs);
  const pushes: EnginePush[] = [];
  const closed: number[] = [];
  const told: number[] = [];
  const arrivals: ArrivalDraft[] = [];
  const parts: LiquidWatchParts = {
    unbondings: {
      openOf: async () => Promise.resolve(setup.rows),
      markTold: async (marked) => {
        told.push(...marked.ids);
        return Promise.resolve();
      },
      closeOutside: async ({ id }) => {
        closed.push(id);
        const row = setup.rows.find((item) => item.id === id);
        return Promise.resolve(row === undefined ? err("taken" as const) : ok(row));
      },
    },
    install: {
      read: async () =>
        Promise.resolve({
          wallets: [
            { id: testWallet, ...(setup.agentId === undefined ? {} : { agentId: setup.agentId }) },
          ],
        } as never),
    },
    intents: { list: async () => Promise.resolve(setup.intents ?? []) },
    positions: {
      claim: async (arrival) => {
        arrivals.push(arrival);
        return Promise.resolve(ok(undefined) as never);
      },
    },
    staking: createStakingHost({ venues: [venue], chains: liquidChains(), clock }),
    custody: { account: setup.account ?? (async () => Promise.resolve(ok(wallet))) },
    publish: (push) => {
      pushes.push(push);
    },
    clock,
  };
  return { parts, pushes, closed, told, arrivals };
}

function noticeKeys(pushes: readonly EnginePush[]): readonly string[] {
  return pushes.map((push) => /"key":"([^"]+)"/u.exec(JSON.stringify(push))?.[1] ?? "");
}

describe("the watch of a liquid pool's live parts (decision 0331)", () => {
  it("tells a part the pool's queue released once, naming the pool and the agent", async () => {
    const watched = watchOver({
      rows: [rowOf(1)],
      agentId: testAgent,
      holdings: async () =>
        Promise.resolve([
          holdingOf([{ ref: "1", amount: coin(10n ** 17n), readyAtMs: testNowMs }]),
        ]),
    });

    expect(await watchLiquidParts(watched.parts, new Map(), live)).toStrictEqual({
      told: 1,
      closed: 0,
    });
    expect(watched.told).toStrictEqual([1]);
    expect(watched.pushes).toMatchObject([
      {
        data: {
          key: "notice.claimReady",
          agent: testAgent,
          values: { validator: shortAddress(addressPartOf(pool)) },
        },
      },
    ]);
  });

  it("closes a part the pool no longer lists, its coin at what it recorded or with no value", async () => {
    const { valueUsdMicros: _value, ...unvalued } = rowOf(2);
    const watched = watchOver({
      rows: [rowOf(1), unvalued],
      holdings: async () => Promise.resolve([]),
    });

    expect(await watchLiquidParts(watched.parts, new Map(), live)).toStrictEqual({
      told: 0,
      closed: 2,
    });
    expect(watched.arrivals.map(({ valueUsdMicros }) => valueUsdMicros)).toStrictEqual([
      60_000_000n,
      undefined,
    ]);
    expect(noticeKeys(watched.pushes)).toStrictEqual([
      "notice.claimedElsewhere",
      "notice.claimedElsewhere",
    ]);
    expect(JSON.stringify(watched.pushes)).not.toContain('"agent"');
  });

  it("leaves open a part a live claim of binference names", async () => {
    const claim = {
      kind: "stake",
      walletId: testWallet,
      quote: stakeQuoteDocument.encode({
        venue: "fake-liquid",
        plan: claimOf(["1"]),
        liquid: true,
      }),
    } as IntentRecord;
    const swap = { kind: "swap", walletId: testWallet } as IntentRecord;
    const watched = watchOver({
      rows: [rowOf(1), rowOf(2)],
      holdings: async () => Promise.resolve([]),
      intents: [swap, claim],
    });

    await watchLiquidParts(watched.parts, new Map(), live);

    expect(watched.closed).toStrictEqual([2]);
  });

  it("waits for a later pass while the wallet's account or the pool cannot be read", async () => {
    const noAccount = watchOver({
      rows: [rowOf(1)],
      holdings: async () => Promise.resolve([]),
      account: async () => Promise.resolve(err("not_found" as const) as never),
    });
    const poolDown = watchOver({
      rows: [rowOf(1)],
      holdings: async () => Promise.reject(new Error("down")),
    });

    expect(await watchLiquidParts(noAccount.parts, new Map(), live)).toStrictEqual({
      told: 0,
      closed: 0,
    });
    expect(await watchLiquidParts(poolDown.parts, new Map(), live)).toStrictEqual({
      told: 0,
      closed: 0,
    });
    expect([...noAccount.closed, ...poolDown.closed]).toStrictEqual([]);
  });

  it("watches only rows of a pool it runs, whose time came", async () => {
    const { validator: _validator, ...noValidator } = rowOf(3);
    const watched = watchOver({
      rows: [
        rowOf(1, { readyAtMs: testNowMs + 60_000 }),
        rowOf(2, { venue: "fake-staking" }),
        noValidator,
      ],
      holdings: async () => Promise.reject(new Error("never asked")),
    });

    expect(await watchLiquidParts(watched.parts, new Map(), live)).toStrictEqual({
      told: 0,
      closed: 0,
    });
  });
});
