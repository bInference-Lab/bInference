import { accountRefSchema, assetRefSchema, type TxHash, type UsdPrice } from "@binference/chain";
import type { StakePlan } from "@binference/chain/staking";
import { bpsSchema, err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { createMemoryUnbondingStore } from "../fakes/memory-unbonding-store.js";
import { createPositions, type Positions } from "../positions/create-positions.js";
import {
  bookStake,
  claimArrivalsOf,
  type StakeBooking,
  type StakeBookParts,
} from "./book-stake.js";
import type { UnbondingRecord } from "./unbonding-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const validator = accountRefSchema.parse("fake:1:0x000000c1");
const walletId = fixtureId("wal", 1);
const whole = 10n ** 18n;
// A price in dollars per whole coin, as micro-dollars per base unit.
const usd = (dollars: bigint): UsdPrice => ({
  numerator: dollars * 1_000_000n,
  denominator: whole,
});

function planOf(action: StakePlan["action"], change: Partial<StakePlan> = {}): StakePlan {
  return {
    action,
    wallet,
    validator,
    validatorName: "Active",
    commissionBps: bpsSchema.parse(700),
    jailed: false,
    paper: false,
    value: { asset: coin, base: action === "stake" ? whole : 0n },
    moved: { asset: coin, base: whole },
    unbondingSeconds: 604_800,
    plannedAtMs: 1_000,
    ...change,
  };
}

function bookingOf(n: number, plan: StakePlan, change: Partial<StakeBooking> = {}): StakeBooking {
  return {
    record: { id: fixtureId("int", n), walletId, isPaper: false },
    quote: { venue: "fake-staking", plan },
    moved: plan.moved,
    gas: { asset: coin, base: 0n },
    coinPrice: usd(600n),
    atMs: 10_000 * n,
    ...change,
  };
}

// Positions, unbondings and the stored executions and arrivals of one wallet, which holds 2 coins
// at $600 and 1 receipt unit per coin staked before at $500.
async function walletOf(): Promise<
  StakeBookParts & { readonly store: ReturnType<typeof createMemoryPositionStore> }
> {
  const store = createMemoryPositionStore();
  const positions = createPositions({ store, prices: createFakePriceSource(new Map()) });
  const unbondings = createMemoryUnbondingStore({ hasIntent: () => true });
  const held = { walletId, isPaper: false, atMs: 1 } as const;
  await positions.claim(
    { ...held, received: { asset: coin, base: 2n * whole }, valueUsdMicros: 1_200_000_000n },
    live(),
  );
  await positions.claim(
    { ...held, received: { asset: receipt, base: whole }, valueUsdMicros: 500_000_000n },
    live(),
  );
  return { positions, unbondings, booked: store, store };
}

// Positions whose first unstake sale stops, as an engine that stops between its two writes.
function stoppingOnce(positions: Positions): Positions {
  const state = { stopped: false };
  return {
    ...positions,
    unbond: async (trade, call) => {
      if (!state.stopped) {
        state.stopped = true;
        throw new Error("The engine stopped.");
      }
      return positions.unbond(trade, call);
    },
  };
}

async function executionsOf(parts: StakeBookParts) {
  return parts.booked.executions({ isPaper: false, walletId, after: 0, limit: 100 }, live());
}

async function arrivalsOf(parts: StakeBookParts) {
  const all = await parts.booked.arrivals(
    { isPaper: false, walletId, after: 0, limit: 100 },
    live(),
  );
  return all.filter((arrival) => arrival.atMs > 1);
}

const unstake = planOf("unstake", {
  shares: { asset: receipt, base: whole },
  readyAtMs: 605_801_000,
});
const request = {
  ref: "0x000000c1:0",
  amount: { asset: coin, base: whole },
  readyAtMs: 605_801_000,
};

describe("booking a staking move (decision 0327)", () => {
  it("books a stake as the coin it spent for the receipt units it minted, once", async () => {
    const parts = await walletOf();
    const booking = bookingOf(2, planOf("stake"), { shares: { asset: receipt, base: whole } });
    await expect(bookStake(parts, booking, live())).resolves.toBe(true);
    await expect(bookStake(parts, booking, live())).resolves.toBe(true);
    const executions = await executionsOf(parts);
    expect(executions.map(({ sold, bought }) => [sold, bought])).toStrictEqual([
      [
        { asset: coin, base: whole },
        { asset: receipt, base: whole },
      ],
    ]);
  });

  it("opens an unstake's unbonding before its sale, so a stop between them loses neither", async () => {
    const parts = await walletOf();
    const stopping = { ...parts, positions: stoppingOnce(parts.positions) };
    const booking = bookingOf(3, unstake, { shares: { asset: receipt, base: whole }, request });
    await expect(bookStake(stopping, booking, live())).rejects.toThrow("The engine stopped.");
    const query = { walletId, isPaper: false, venue: "fake-staking", validator };
    expect([
      (await parts.unbondings.listOpen(query, live())).length,
      (await executionsOf(parts)).length,
    ]).toStrictEqual([1, 0]);
    await expect(bookStake(stopping, booking, live())).resolves.toBe(true);
    await expect(bookStake(stopping, booking, live())).resolves.toBe(true);
    expect([
      (await parts.unbondings.listOpen(query, live())).length,
      (await executionsOf(parts)).length,
    ]).toStrictEqual([1, 1]);
  });

  it("sells an unstake booked again after a stop at the price its unbonding recorded", async () => {
    const parts = await walletOf();
    const stopping = { ...parts, positions: stoppingOnce(parts.positions) };
    const first = bookingOf(4, unstake, { shares: { asset: receipt, base: whole }, request });
    await expect(bookStake(stopping, first, live())).rejects.toThrow("The engine stopped.");
    await bookStake(stopping, { ...first, coinPrice: usd(900n) }, live());
    const [sale] = await executionsOf(parts);
    expect(sale?.valueUsdMicros).toBe(600_000_000n);
  });

  it("opens an unstake's unbonding without a value while no price is known, and sells once one is", async () => {
    const parts = await walletOf();
    const { coinPrice: _price, ...unpriced } = bookingOf(5, unstake, {
      shares: { asset: receipt, base: whole },
      request,
    });
    await expect(bookStake(parts, unpriced, live())).resolves.toBe(false);
    const query = { walletId, isPaper: false, venue: "fake-staking", validator };
    const [row] = await parts.unbondings.listOpen(query, live());
    expect([row?.valueUsdMicros, (await executionsOf(parts)).length]).toStrictEqual([undefined, 0]);
    await expect(bookStake(parts, { ...unpriced, coinPrice: usd(600n) }, live())).resolves.toBe(
      true,
    );
    expect(await executionsOf(parts)).toHaveLength(1);
  });

  it("books a claim's coin at what its unstake recorded, a part made elsewhere with no value, each once", async () => {
    const parts = await walletOf();
    const unstaked = bookingOf(6, unstake, { shares: { asset: receipt, base: whole }, request });
    await bookStake(parts, unstaked, live());
    const claim = planOf("claim", {
      parts: [request.ref, "0x000000c1:1"],
      moved: { asset: coin, base: 3n * whole },
    });
    const claimed = bookingOf(7, claim, { claimed: [request.ref, "0x000000c1:1"] });
    await expect(bookStake(parts, claimed, live())).resolves.toBe(true);
    await expect(bookStake(parts, claimed, live())).resolves.toBe(true);
    const arrivals = await arrivalsOf(parts);
    expect(
      arrivals.map(({ received, valueUsdMicros }) => [received.base, valueUsdMicros]),
    ).toStrictEqual([
      [whole, 600_000_000n],
      [2n * whole, undefined],
    ]);
    const taken = await parts.unbondings.claimedBy(fixtureId("int", 7), live());
    expect(taken.map((row) => row.requestRef)).toStrictEqual([request.ref]);
  });
});

// Positions whose stake writes lose their race to another write the first `times` tries.
function staleFor(positions: Positions, times: number): Positions {
  let left = times;
  return {
    ...positions,
    record: async (trade, call) => {
      if (left > 0) {
        left -= 1;
        return err("stale" as const);
      }
      return positions.record(trade, call);
    },
  };
}

describe("booking a staking move it cannot book whole", () => {
  it("books nothing of a stake that read back no units, or with no coin price", async () => {
    const parts = await walletOf();
    const noUnits = bookingOf(8, planOf("stake"));
    const { coinPrice: _price, ...unpriced } = bookingOf(9, planOf("stake"), {
      shares: { asset: receipt, base: whole },
    });

    await expect(bookStake(parts, noUnits, live())).resolves.toBe(false);
    await expect(bookStake(parts, unpriced, live())).resolves.toBe(false);
    expect(await executionsOf(parts)).toStrictEqual([]);
  });

  it("books nothing of an unstake with no units, no request, or that burned none", async () => {
    const parts = await walletOf();
    const shares = { asset: receipt, base: whole };
    const bookings = [
      bookingOf(10, unstake, { request }),
      bookingOf(11, unstake, { shares }),
      bookingOf(12, unstake, { shares: { ...shares, base: 0n }, request }),
    ];

    for (const booking of bookings) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each books against the same wallet
      await expect(bookStake(parts, booking, live())).resolves.toBe(false);
    }
    const query = { walletId, isPaper: false, venue: "fake-staking", validator };
    expect(await parts.unbondings.listOpen(query, live())).toStrictEqual([]);
  });

  it("tries a stake's write another write beat again, and gives up after three", async () => {
    const parts = await walletOf();
    const booking = bookingOf(13, planOf("stake"), { shares: { asset: receipt, base: whole } });
    const twice = { ...parts, positions: staleFor(parts.positions, 2) };
    const always = { ...parts, positions: staleFor(parts.positions, 3) };

    await expect(bookStake(always, booking, live())).resolves.toBe(false);
    await expect(bookStake(twice, booking, live())).resolves.toBe(true);
    expect(await executionsOf(parts)).toHaveLength(1);
  });

  it("books a claim that names no part as its coin arriving with no value", async () => {
    const parts = await walletOf();
    const claim = planOf("claim", { moved: { asset: coin, base: whole } });

    await expect(bookStake(parts, bookingOf(14, claim), live())).resolves.toBe(true);
    const arrivals = await arrivalsOf(parts);
    expect(
      arrivals.map(({ received, valueUsdMicros }) => [received.base, valueUsdMicros]),
    ).toStrictEqual([[whole, undefined]]);
  });
});

// An unbonding row of the coin, with what its unstake recorded it worth when given.
function rowOf(base: bigint, valueUsdMicros?: bigint): UnbondingRecord {
  return {
    amount: { asset: coin, base },
    ...(valueUsdMicros === undefined ? {} : { valueUsdMicros }),
  } as UnbondingRecord;
}

// A claim's transaction hash.
const hash = `0x${"ab".repeat(32)}` as TxHash;

describe("a claim's arrivals", () => {
  const record = { id: fixtureId("int", 15), walletId, isPaper: false };

  it("is one arrival at what the unstakes recorded when they cover the whole claim", () => {
    const arrivals = claimArrivalsOf([rowOf(whole, 600_000_000n)], {
      record,
      moved: { asset: coin, base: whole },
      atMs: 1,
    });

    expect(
      arrivals.map(({ received, valueUsdMicros }) => [received.base, valueUsdMicros]),
    ).toStrictEqual([[whole, 600_000_000n]]);
  });

  it("is the whole claim with no value when its rows recorded more than it moved", () => {
    const arrivals = claimArrivalsOf([rowOf(2n * whole, 1_200_000_000n)], {
      record,
      moved: { asset: coin, base: whole },
      atMs: 1,
      txHash: hash,
    });

    expect(arrivals).toStrictEqual([
      {
        walletId,
        isPaper: false,
        atMs: 1,
        txHash: hash,
        received: { asset: coin, base: whole },
      },
    ]);
  });
});
