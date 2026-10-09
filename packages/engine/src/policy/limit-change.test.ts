import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testLimits } from "../intents/test-intents.js";
import {
  cancelLimits,
  limitsAt,
  limitsChanged,
  moveLimits,
  type LimitsState,
} from "./limit-change.js";
import { looseningWaitMs } from "./send-level-change.js";

const nowMs = 1_700_000_000_000;
const chain = chainRefSchema.parse("fake:1");
const tokenA = assetRefSchema.parse("fake:1/token:a");
const tokenB = assetRefSchema.parse("fake:1/token:b");
const now: LimitsState = { values: testLimits };
const later = nowMs + looseningWaitMs;

describe("a move of an agent's limits", () => {
  it("applies a lower cap, a higher floor and fewer venues at once", () => {
    const move = moveLimits(
      now,
      { perTradeUsdMicros: 1n, liquidityFloorUsdMicros: 5n, venues: [] },
      nowMs,
    );
    expect(move.stricter).toStrictEqual(["perTradeUsdMicros", "liquidityFloorUsdMicros", "venues"]);
    expect([move.looser, move.next.pending]).toStrictEqual([[], undefined]);
    expect(move.next.values.perTradeUsdMicros).toBe(1n);
  });

  it("makes a higher cap, a smaller gas reserve and a new venue wait 24 hours", () => {
    const gasReserve = [{ chain, reserveBase: 1n }];
    const changes = { perTradeUsdMicros: 10n ** 12n, gasReserve, venues: ["fake-swap", "other"] };
    const move = moveLimits(now, changes, nowMs);

    expect(move.looser).toStrictEqual(["perTradeUsdMicros", "gasReserve", "venues"]);
    expect(move.next.values).toStrictEqual(testLimits);
    expect(move.next.pending).toStrictEqual({
      values: { ...testLimits, ...changes },
      atMs: later,
    });
    expect(limitsAt(move.next, later - 1).values).toStrictEqual(testLimits);
    expect(limitsAt(move.next, later).values).toStrictEqual({ ...testLimits, ...changes });
  });

  it("judges token lists by what they allow: a narrower allow list, a wider deny list", () => {
    const narrowed = moveLimits(now, { allowTokens: [tokenA], denyTokens: [tokenB] }, nowMs);
    expect(narrowed.stricter).toStrictEqual(["allowTokens", "denyTokens"]);
    const widened = moveLimits(narrowed.next, { allowTokens: [], denyTokens: [] }, nowMs);
    expect(widened.looser).toStrictEqual(["allowTokens", "denyTokens"]);
  });

  it("keeps the time of looser limits asked for again, and restarts it for another", () => {
    const first = moveLimits(now, { perTradeUsdMicros: 10n ** 12n }, nowMs);
    const again = moveLimits(first.next, { perTradeUsdMicros: 10n ** 12n }, nowMs + 60_000);
    expect(again.next.pending?.atMs).toBe(later);
    const other = moveLimits(first.next, { taxBps: bpsSchema.parse(2_000) }, nowMs + 60_000);
    expect(other.next.pending?.atMs).toBe(later + 60_000);
    expect(other.next.pending?.values.perTradeUsdMicros).toBe(10n ** 12n);
  });

  it("drops a looser value that waits when the same limit is set stricter", () => {
    const first = moveLimits(
      now,
      { perTradeUsdMicros: 10n ** 12n, taxBps: bpsSchema.parse(2_000) },
      nowMs,
    );
    const braked = moveLimits(first.next, { perTradeUsdMicros: 1n }, nowMs + 1);

    expect(braked.stricter).toStrictEqual(["perTradeUsdMicros"]);
    expect(braked.next.pending?.values.perTradeUsdMicros).toBe(1n);
    expect(braked.next.pending?.atMs).toBe(later);
    const both = moveLimits(braked.next, { taxBps: testLimits.taxBps }, nowMs + 2);
    expect(both.next).toStrictEqual({ values: { ...testLimits, perTradeUsdMicros: 1n } });
  });

  it("cancels the limits that wait, and names what changed between two sets", () => {
    const first = moveLimits(now, { orderExpiryDays: 90 }, nowMs);

    expect(cancelLimits(first.next, nowMs)).toStrictEqual(now);
    expect(cancelLimits(first.next, later)).toStrictEqual({
      values: { ...testLimits, orderExpiryDays: 90 },
    });
    expect(limitsChanged(testLimits, { ...testLimits, orderExpiryDays: 90 })).toStrictEqual([
      "orderExpiryDays",
    ]);
  });
});
