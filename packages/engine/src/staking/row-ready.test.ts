import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testCoin, testWallet } from "../intents/test-intents.js";
import { createStakingHost } from "../venues/staking-host.js";
import { isRowReady } from "./row-ready.js";
import { liquidChains, testLiquidFake } from "./test-liquid-stakes.js";
import { testValidator } from "./test-stakes.js";
import type { UnbondingRecord } from "./unbonding-record.js";

const nowMs = 1_800_000_000_000;
const liquid = testLiquidFake();
const staking = createStakingHost({
  venues: [liquid],
  chains: liquidChains(),
  clock: createManualClock(nowMs),
});

function rowOf(change: Partial<UnbondingRecord>): UnbondingRecord {
  return {
    id: 1,
    intentId: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as never,
    walletId: testWallet,
    venue: liquid.id,
    validator: liquid.pool,
    requestRef: "1",
    amount: { asset: testCoin, base: 10n },
    readyAtMs: nowMs - 1,
    isPaper: false,
    ...change,
  };
}

describe("whether an unbonding's coin can be claimed now (decision 0331)", () => {
  it("waits for a liquid venue's queue on a live row, until the owner was told it is released", () => {
    const context = { nowMs, staking };
    expect(isRowReady(rowOf({}), context)).toBe(false);
    expect(isRowReady(rowOf({ toldReadyAtMs: nowMs }), context)).toBe(true);
    expect(isRowReady(rowOf({ isPaper: true }), context)).toBe(true);
    expect(isRowReady(rowOf({ readyAtMs: nowMs + 1, toldReadyAtMs: nowMs }), context)).toBe(false);
  });

  it("goes by time alone for a venue of validators", () => {
    const row = rowOf({ venue: "fake-staking", validator: testValidator });
    expect(isRowReady(row, { nowMs, staking })).toBe(true);
    expect(isRowReady({ ...row, readyAtMs: nowMs + 1 }, { nowMs, staking })).toBe(false);
  });
});
