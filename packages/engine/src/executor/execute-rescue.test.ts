import type { StepAction } from "@binference/chain";
import { accountRefSchema } from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import { type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { expectOk, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import {
  payloadOf,
  rescueCustody,
  rescueSteps,
  secondAccount,
  secondWallet,
  setUpRescue,
  testHeld,
  testMoves,
  testRescue,
} from "../safety/test-rescue.js";
import {
  type BenchOptions,
  driveUntil,
  type ExecutorBench,
  flush,
  startExecutorBench,
  stateOf,
} from "./test-executor.js";
import { restartBench } from "./test-restart.js";

const live = { signal: new AbortController().signal };
const engine = {
  custodyWallets: rescueCustody,
  held: testHeld,
  chainSimulator: createFakeTxSimulator(rescueSteps()),
};

async function benchWithRescue(options: BenchOptions = {}): Promise<ExecutorBench> {
  const bench = await startExecutorBench({ ...options, engine });
  await setUpRescue(bench.test);
  return bench;
}

// The owner asks for a rescue and taps Confirm on its card.
async function rescueConfirmed(bench: ExecutorBench): Promise<Id<"int">> {
  const handlers = bench.test.engine.handlers;
  const { intent } = expectOk(await handlers["safety/rescue"](testCall({})));
  const view = expectOk(await handlers["intent/get"](testCall({ intent })));
  const args = { intent, card: view.card?.card ?? fixtureId("crd", 0), cardVersion: 1 };
  expectOk(await handlers["intent/confirm"](testCall(args)));
  return intent;
}

function sendOf(index: number): StepAction {
  const move = testMoves[index];
  if (move === undefined) {
    throw new Error(`Expected move ${String(index)}.`);
  }
  const isToken = index === 0;
  return isToken
    ? {
        kind: "send",
        recipient: testRescue,
        token: "fake:1:0x0000000a" as never,
        amount: move.amount.base,
      }
    : { kind: "send", recipient: testRescue, amount: move.amount.base };
}

describe("a confirmed rescue on its wallets' queues", () => {
  it("sends every move from its own wallet to the rescue address, then reconciles", async () => {
    const bench = await benchWithRescue();
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ wallet, step }) => [wallet, step.index, step.action])).toStrictEqual(
      [
        [testWallet, 0, sendOf(0)],
        [testWallet, 1, sendOf(1)],
        [secondWallet, 2, sendOf(2)],
      ],
    );
    expect(bench.signed.every(({ allowed }) => allowed.recipients.includes(testRescue))).toBe(true);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ account, nonce, state }) => [account, nonce, state])).toStrictEqual([
      [testAccount, 0, "final"],
      [testAccount, 1, "final"],
      [secondAccount, 0, "final"],
    ]);
  });

  it("runs while the agent is on paper, since a rescue moves the real funds", async () => {
    const bench = await benchWithRescue({ agent: { mode: "paper" } });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(3);
  });

  it("tries a step that reverts again once its block is final, three times, and sends the rest", async () => {
    const reverting = testMoves.slice(0, 1).map(payloadOf);
    const bench = await benchWithRescue({ network: { reverting } });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"], blocks: 200 })).resolves.toBe(
      "reconciled",
    );
    const indexes = bench.signed.map(({ step }) => step.index);
    expect(indexes).toStrictEqual([0, 0, 0, 0, 1, 2]);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ state }) => state)).toStrictEqual([
      "reverted",
      "reverted",
      "reverted",
      "reverted",
      "final",
      "final",
    ]);
  });

  it("is not taken once the address its card confirmed is no longer the rescue address", async () => {
    const bench = await benchWithRescue({ hold: true });
    const intent = await rescueConfirmed(bench);
    const other = accountRefSchema.parse("fake:1:0x000000b2");
    const atMs = bench.test.clock.now() - looseningWaitMs - 1;
    await bench.test.stores.install.changeRescue({ address: other, atMs }, live);
    await bench.release();
    await flush();
    await expect(stateOf(bench, intent)).resolves.toBe("confirmed");
    expect(bench.signed).toStrictEqual([]);
  });

  it("goes on after a restart without signing a step sent before the stop again", async () => {
    const bench = await benchWithRescue();
    const intent = await rescueConfirmed(bench);
    await flush();
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0]);
    const restarted = await restartBench(bench);
    expect(restarted.recovered).toBe(1);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([1, 2]);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ step, state }) => [step, state])).toStrictEqual([
      [0, "final"],
      [1, "final"],
      [2, "final"],
    ]);
  });
});
