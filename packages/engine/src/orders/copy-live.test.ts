import { bpsSchema, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { driveUntil, flush } from "../executor/test-executor.js";
import { testToken } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import { copiedHeldOf } from "./copy-state.js";
import { copyStateNow, leaderTrade, storeTrades } from "./test-copies.js";
import { fillPrices } from "./test-fills.js";
import { activeOrderOf, liveFillsOf, startLiveFills } from "./test-live-fills.js";
import { testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// The fake venue pays two base units for one, so the token's price keeps a copy's sale small.
const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });

describe("a live copy order", () => {
  it("waits for its own buy to land before it reads the leader's sale, then sells it", async () => {
    // The wallet holds the token on chain, as the landed buy left it.
    const held = new Map([[testAccount, [{ asset: testToken, base: 10n ** 20n }]]]);
    const bench = await startLiveFills({ prices, held });
    const order = await activeOrderOf(bench, testCopy());
    await storeTrades(bench.test, [leaderTrade(1, { side: "buy", atMs: bench.test.clock.now() })]);
    await bench.test.engine.runCopies(live);
    const share = bpsSchema.parse(4_000);
    const atMs = bench.test.clock.now();
    await storeTrades(bench.test, [leaderTrade(2, { side: "sell", atMs, shareSoldBps: share })]);

    await bench.test.engine.runCopies(live);
    const waiting = await copyStateNow(bench.test, order.id);
    const [buy] = await liveFillsOf(bench);
    await driveUntil(bench, buy?.id as Id<"int">, { states: ["reconciled"] });
    await flush();
    const bought = copiedHeldOf(await copyStateNow(bench.test, order.id), testToken);
    await bench.test.engine.runCopies(live);
    const [sale] = await liveFillsOf(bench, "sell");
    await driveUntil(bench, sale?.id as Id<"int">, { states: ["reconciled"] });
    await flush();

    expect(waiting.through).toBe(1);
    expect(bought).toBeGreaterThan(0n);
    expect(sale).toBeDefined();
    const left = copiedHeldOf(await copyStateNow(bench.test, order.id), testToken);
    expect(left).toBe(bought - (bought * 4_000n) / 10_000n);
  });
});
