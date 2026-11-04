import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import { copyStateNow, leaderTrade, storeTrades } from "./test-copies.js";
import { fillPrices, fillRowsOf } from "./test-fills.js";
import { activeOrderOf, liveFillsOf, startLiveFills } from "./test-live-fills.js";
import { testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// The fake venue pays two base units for one, so the token's price keeps a copy's buy small.
const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });

// Two live copy orders of the test agent that follow the test leader.
async function twoLiveCopies() {
  const held = new Map([[testAccount, [{ asset: testToken, base: 10n ** 20n }]]]);
  const bench = await startLiveFills({ prices, held });
  const first = await activeOrderOf(bench, testCopy());
  const second = await activeOrderOf(bench, testCopy());
  return { bench, first, second };
}

describe("a live copy order behind its agent's live fill", () => {
  it("records the trade it took as waiting, so the owner hears it, and buys once", async () => {
    const { bench, first, second } = await twoLiveCopies();
    await storeTrades(bench.test, [leaderTrade(1, { side: "buy", atMs: bench.test.clock.now() })]);

    await bench.test.engine.runCopies(live);

    expect(await fillRowsOf(bench.test, first.id)).toStrictEqual([]);
    expect(await fillRowsOf(bench.test, second.id)).toMatchObject([
      {
        outcome: "skipped",
        reason: "fill_waiting",
        copy: { trade: 1, take: 1 },
        notices: [{ key: "notice.skipped" }],
      },
    ]);
    expect(await liveFillsOf(bench)).toHaveLength(1);
  });

  it("takes no further trade while the line stays held, leaving it to a later run", async () => {
    const { bench, second } = await twoLiveCopies();
    const atMs = bench.test.clock.now();
    await storeTrades(bench.test, [
      leaderTrade(1, { side: "buy", atMs }),
      leaderTrade(2, { side: "buy", atMs }),
    ]);

    await bench.test.engine.runCopies(live);

    const state = await copyStateNow(bench.test, second.id);
    expect({ through: state.through, takes: state.takes }).toStrictEqual({ through: 1, takes: 1 });
    expect(await fillRowsOf(bench.test, second.id)).toHaveLength(1);
    expect(await liveFillsOf(bench)).toHaveLength(1);
  });
});
