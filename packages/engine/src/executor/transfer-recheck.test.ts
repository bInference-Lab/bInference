import { accountRefSchema, type Amount } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testLimits, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";
import { holdTestWallet, testNames, testSend, transferSimulator } from "../sends/test-transfers.js";
import {
  driveUntil,
  type ExecutorBench,
  startExecutorBench,
  stateOf,
  tapped,
} from "./test-executor.js";

// The wallet queue checks a confirmed send's policy again before it signs (spec 6, `queue_took`):
// a target the owner forbade after the tap is never paid.
const live = { signal: new AbortController().signal };
const coin: Amount = { asset: testCoin, base: 10n ** 15n };
const rescue = accountRefSchema.parse("fake:1:0x000000a1");
const nextRescue = accountRefSchema.parse("fake:1:0x000000a2");
const settled = { states: ["executing", "included", "finalized", "reconciled"] } as const;

async function benchWith(
  agent: Parameters<typeof startExecutorBench>[0] = {},
): Promise<ExecutorBench> {
  const names = testNames();
  names.set("alice.bnb", { address: testSaved.account });
  const bench = await startExecutorBench({
    hold: true,
    ...agent,
    engine: {
      nameResolvers: [names],
      chainSimulator: transferSimulator([
        { to: testSaved.account, amount: coin },
        { to: rescue, amount: coin },
      ]),
    },
  });
  holdTestWallet(bench.test);
  return bench;
}

// The queue's take after the change: a few blocks, then what was signed and where the send stands.
async function takenAfter(bench: ExecutorBench, intent: Id<"int">) {
  await bench.release();
  await driveUntil(bench, intent, { ...settled, blocks: 3 });
  return { signed: bench.signed.length, state: await stateOf(bench, intent) };
}

describe("the wallet queue's check of a confirmed send", () => {
  it("pays nothing to a saved address removed after the tap", async () => {
    const bench = await benchWith();
    await saveTestAddress(bench.test);
    const intent = await tapped(bench, testSend());
    await bench.test.stores.agents.removeAddress({ id: testSaved.id, atMs: testNowMs }, live);
    await expect(takenAfter(bench, intent)).resolves.toStrictEqual({
      signed: 0,
      state: "confirmed",
    });
  });

  it("pays nothing once the send level was raised to 3 after the tap", async () => {
    const bench = await benchWith();
    await saveTestAddress(bench.test);
    const intent = await tapped(bench, testSend({ name: "alice.bnb" }));
    const raised = await bench.test.engine.handlers["sendLevel/set"](
      testCall({ agent: testAgent, level: 3 }),
    );
    expect(raised.ok).toBe(true);
    await expect(takenAfter(bench, intent)).resolves.toStrictEqual({
      signed: 0,
      state: "confirmed",
    });
  });

  it("pays nothing to a saved address still cooling once level 2 came after the tap", async () => {
    const bench = await benchWith();
    const cooling = { ...testSaved, usableAtMs: testNowMs + looseningWaitMs };
    await saveTestAddress(bench.test, cooling);
    const intent = await tapped(bench, testSend({ entry: cooling.id }));
    const raised = await bench.test.engine.handlers["sendLevel/set"](
      testCall({ agent: testAgent, level: 2 }),
    );
    expect(raised.ok).toBe(true);
    await expect(takenAfter(bench, intent)).resolves.toStrictEqual({
      signed: 0,
      state: "confirmed",
    });
  });

  it("pays nothing to the old rescue address once a new one took effect after the tap", async () => {
    const bench = await benchWith();
    const { install } = bench.test.stores;
    await install.changeRescue({ address: rescue, atMs: testNowMs - 3 * looseningWaitMs }, live);
    await install.changeRescue(
      { address: nextRescue, atMs: testNowMs - looseningWaitMs + 1 },
      live,
    );
    const intent = await tapped(bench, testSend({ address: rescue }));
    await bench.test.clock.advance(1_000);
    await expect(takenAfter(bench, intent)).resolves.toStrictEqual({
      signed: 0,
      state: "confirmed",
    });
  });

  it("still pays a target nothing forbade since the tap", async () => {
    const bench = await benchWith();
    await saveTestAddress(bench.test);
    const intent = await tapped(bench, testSend());
    const { signed } = await takenAfter(bench, intent);
    expect(signed).toBe(1);
  });
});

describe("a send that ended without moving anything", () => {
  it("leaves the 24-hour cap free for the next send after its name moved (decision 0136)", async () => {
    const cap = 1_000_000n;
    const limits = { ...testLimits, perTradeUsdMicros: cap, rollingDayUsdMicros: cap };
    const names = testNames();
    names.set("alice.bnb", { address: testSaved.account });
    const bench = await startExecutorBench({
      hold: true,
      agent: { limits },
      engine: {
        nameResolvers: [names],
        chainSimulator: transferSimulator([{ to: testSaved.account, amount: coin }]),
      },
    });
    await saveTestAddress(bench.test);
    const moved = await tapped(bench, testSend({ name: "alice.bnb" }));
    names.set("alice.bnb", { address: accountRefSchema.parse("fake:1:0x000000f2") });
    await bench.release();
    await expect(driveUntil(bench, moved, { states: ["failed_check"] })).resolves.toBe(
      "failed_check",
    );
    // A tap past the cap throws `limit.daily_cap` here.
    const next = await tapped(bench, testSend());
    await expect(stateOf(bench, next)).resolves.toBe("confirmed");
  });
});
