import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  expectOk,
  testAgent,
  testCoin,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import type { Executor } from "../ports.js";
import { startTestEngine, type TestEngine, testCall, testCallers } from "./test-engine.js";

const live = { signal: new AbortController().signal };

// Stands in for the wallet queue: anything that reaches it fails the test.
const walletQueueNeverReached: Executor = {
  async take(intent) {
    return await Promise.reject(new Error(`Intent ${intent} reached the wallet queue.`));
  },
};

async function paperBalances(test: TestEngine): Promise<readonly (readonly [string, bigint])[]> {
  const held = await test.positions.positions({ walletId: testWallet, isPaper: true }, live);
  return held.map((position) => [position.asset, position.quantityBase] as const);
}

async function confirmed(test: TestEngine, caller = testCallers.cli) {
  const handlers = test.engine.handlers;
  const view = expectOk(await handlers["intent/propose"](testCall(testSwap(), caller)));
  const card = view.card?.card as Id<"crd">;
  const args = { intent: view.intent, card, cardVersion: 1 };
  return expectOk(await handlers["intent/confirm"](testCall(args)));
}

describe("paper mode", () => {
  it("fills a confirmed paper intent at its quote and never reaches the wallet queue", async () => {
    const test = await startTestEngine({ executor: walletQueueNeverReached });
    const view = await confirmed(test);
    expect([view.state, view.paper]).toStrictEqual(["paper_filled", true]);
    expect(await paperBalances(test)).toStrictEqual([
      [testCoin, 10n ** 18n - 1_000_000n],
      [testToken, 2_000_000n],
    ]);
    expect(test.executor.taken()).toStrictEqual([]);
  });

  it("fills a paper intent the auto mode confirms the same way, with no card", async () => {
    const test = await startTestEngine({
      agent: { approvalMode: "auto" },
      executor: walletQueueNeverReached,
    });
    const handlers = test.engine.handlers;
    const view = expectOk(
      await handlers["intent/propose"](testCall(testSwap(), testCallers.runtime)),
    );
    expect([view.state, view.card]).toStrictEqual(["paper_filled", undefined]);
    expect((await paperBalances(test))[1]).toStrictEqual([testToken, 2_000_000n]);
  });

  it("hands a confirmed live intent to the wallet queue, paper portfolio untouched", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    const handlers = test.engine.handlers;
    const view = expectOk(
      await handlers["intent/propose"](testCall(testSwap(), testCallers.runtime)),
    );
    expect([view.state, view.paper]).toStrictEqual(["confirmed", false]);
    expect(test.executor.taken()).toStrictEqual([view.intent]);
    expect(await paperBalances(test)).toStrictEqual([[testCoin, 10n ** 18n]]);
  });

  it("keeps a paper intent on paper when the agent goes live before the tap", async () => {
    const test = await startTestEngine({ executor: walletQueueNeverReached });
    const handlers = test.engine.handlers;
    const view = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    expectOk(await handlers["agent/goLive"](testCall({ agent: testAgent })));
    const card = view.card?.card as Id<"crd">;
    const args = { intent: view.intent, card, cardVersion: 1 };
    const answer = expectOk(await handlers["intent/confirm"](testCall(args)));
    expect([answer.state, answer.paper]).toStrictEqual(["paper_filled", true]);
  });
});
