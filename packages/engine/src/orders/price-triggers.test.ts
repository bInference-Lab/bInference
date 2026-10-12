import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { judgeTrigger, triggerStateDocument } from "./price-triggers.js";
import { testStopLoss } from "./test-orders.js";

const at = (micros: bigint) => ({ numerator: micros, denominator: 1n });
const stop = { request: testStopLoss() };
const profit = {
  request: { ...testStopLoss(), kind: "takeProfit", trigger: { price: 800_000n } },
} as const;
const trailing = {
  request: {
    ...testStopLoss(),
    kind: "trailing",
    trigger: { distanceBps: bpsSchema.parse(1_000) },
  },
} as const;

describe("a price trigger", () => {
  it("fires a stop-loss at its price and below, a take-profit at its price and above", () => {
    expect(
      [800_001n, 800_000n, 1n].map((micros) => judgeTrigger(stop, at(micros))?.fires),
    ).toStrictEqual([false, true, true]);
    expect(
      [799_999n, 800_000n].map((micros) => judgeTrigger(profit, at(micros))?.fires),
    ).toStrictEqual([false, true]);
  });

  it("fires a trailing stop exactly at its distance under the peak it kept", () => {
    const kept = {
      ...trailing,
      triggerState: triggerStateDocument.encode({ peak: at(1_000_000n) }),
    };
    expect(judgeTrigger(kept, at(900_001n))).toStrictEqual({
      level: { side: "atOrBelow", price: { numerator: 9_000_000_000n, denominator: 10_000n } },
      fires: false,
    });
    expect(judgeTrigger(kept, at(900_000n))?.fires).toBe(true);
    expect(judgeTrigger(kept, at(1_100_000n))).toMatchObject({
      fires: false,
      state: { peak: at(1_100_000n) },
    });
  });

  it("starts a trailing stop again from the price now when its kept state does not read", () => {
    const broken = { ...trailing, triggerState: { peak: "high" } };
    expect(judgeTrigger(broken, at(500_000n))).toMatchObject({
      fires: false,
      state: { peak: at(500_000n) },
    });
  });

  it("judges no price for an order its price does not trigger", () => {
    const dca = { ...testStopLoss(), kind: "dca", trigger: { cron: "0 9 * * *" } } as const;
    expect(judgeTrigger({ request: dca }, at(1n))).toBeUndefined();
  });
});
