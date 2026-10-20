import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin, testToken } from "../intents/test-intents.js";
import {
  copiedHeldOf,
  copyDayMs,
  copyStartOf,
  copyStateAfterFill,
  copyStateDocument,
  copyStateOf,
  passedState,
  takenState,
  usedInDayOf,
} from "./copy-state.js";
import { testLeaderTx } from "./test-copies.js";

const other = assetRefSchema.parse("fake:1/token:0x0000000b");
const taking = {
  id: 7,
  txHash: testLeaderTx,
  side: "buy" as const,
  asset: testToken,
  atMs: 1_000,
};

function bought(base: bigint, usdMicros: bigint, atMs: number) {
  return {
    side: "buy" as const,
    amountIn: { asset: testCoin, base: 1n },
    amountOut: { asset: testToken, base },
    usdMicros,
    atMs,
  };
}

function sold(base: bigint, atMs: number) {
  return {
    side: "sell" as const,
    amountIn: { asset: testToken, base },
    amountOut: { asset: testCoin, base: 1n },
    usdMicros: 0n,
    atMs,
  };
}

describe("a copy order's state", () => {
  it("starts with nothing taken, bought or held, and reads back from its document", () => {
    const start = copyStartOf(5);
    expect(start).toStrictEqual({
      sinceMs: 5,
      through: 0,
      takes: 0,
      recent: [],
      buys: [],
      held: [],
    });
    const kept = takenState(start, { ...taking, shareSoldBps: bpsSchema.parse(4_000) });
    const json = copyStateDocument.encode(kept);
    expect(copyStateOf(json)).toStrictEqual(kept);
    expect(copyStateOf({ nextAtMs: 5 })).toBeUndefined();
  });

  it("takes a trade with its number, and passes trades over with no trade under way", () => {
    const taken = takenState(copyStartOf(5), taking);
    expect([taken.through, taken.takes, taken.taking]).toStrictEqual([
      7,
      1,
      { ...taking, take: 1 },
    ]);
    const passed = passedState(taken, 9);
    expect(passed.through).toBe(9);
    expect(passed).not.toHaveProperty("taking");
  });

  it("counts a buy's value for a day and adds what it bought to the token's holding", () => {
    const first = copyStateAfterFill(takenState(copyStartOf(0), taking), bought(10n, 20n, 1_000));
    const second = copyStateAfterFill(first, bought(5n, 30n, 2_000));
    expect(second).not.toHaveProperty("taking");
    expect(copiedHeldOf(second, testToken)).toBe(15n);
    expect(copiedHeldOf(second, other)).toBe(0n);
    expect(usedInDayOf(second, 2_000)).toBe(50n);
    expect(usedInDayOf(second, 1_000 + copyDayMs)).toBe(30n);
    expect(usedInDayOf(second, 2_000 + copyDayMs)).toBe(0n);
  });

  it("drops buys older than a day as it records the next fill", () => {
    const first = copyStateAfterFill(copyStartOf(0), bought(10n, 20n, 1_000));
    const later = copyStateAfterFill(first, sold(1n, 1_000 + copyDayMs));
    expect(later.buys).toStrictEqual([]);
  });

  it("takes a sale from the holding, never below zero, and forgets an emptied token", () => {
    const held = copyStateAfterFill(copyStartOf(0), bought(10n, 20n, 1_000));
    const part = copyStateAfterFill(held, sold(4n, 2_000));
    expect(copiedHeldOf(part, testToken)).toBe(6n);
    const beyond = copyStateAfterFill(part, sold(9n, 3_000));
    expect(beyond.held).toStrictEqual([]);
  });
});
