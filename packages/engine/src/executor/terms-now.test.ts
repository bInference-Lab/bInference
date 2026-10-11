import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import {
  driveUntil,
  eventsOf,
  type ExecutorBench,
  flush,
  startExecutorBench,
  stateOf,
  tapped,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
// The rules run at 3 and 6 blocks, and a step every relay refuses is dropped after 9.
const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live()))?.reason;
}

async function proposeAuto(bench: ExecutorBench, request = testSwap()): Promise<Id<"int">> {
  const handlers = bench.test.engine.handlers;
  return expectOk(await handlers["intent/propose"](testCall(request, testCallers.runtime))).intent;
}

async function goManual(bench: ExecutorBench): Promise<void> {
  const set = bench.test.engine.handlers["approval/set"];
  expectOk(await set(testCall({ agent: testAgent, mode: "manual" as const })));
}

describe("the authorization read again before each signature", () => {
  it("signs no later step of an auto intent once the agent switched to manual", async () => {
    const bench = await startExecutorBench({ agent: { approvalMode: "auto" }, hold: true });
    const intent = await proposeAuto(bench, tokenSale);
    bench.network.holdBelow(10n ** 18n);
    await bench.release();
    await flush();
    await goManual(bench);
    bench.network.holdBelow(0n);
    await driveUntil(bench, intent, { states: ["failed_onchain"], blocks: 3 });
    expect(await reasonOf(bench, intent)).toBe("step_unsent");
    expect(eventsOf(bench)).toContain("executor.step_stopped:authorization_lapsed");
    expect(bench.signed).toHaveLength(1);
  });

  it("carries the approval mode as it stands now in each later signature", async () => {
    const bench = await startExecutorBench({ agent: { approvalMode: "auto" } });
    const intent = await proposeAuto(bench, tokenSale);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ authorization }) => authorization)).toMatchObject([
      { kind: "approvalMode", current: { mode: "auto" } },
      { kind: "approvalMode", current: { mode: "auto" } },
    ]);
  });

  it("speeds up no stuck step of an auto intent once the agent switched to manual", async () => {
    const bench = await startExecutorBench({ agent: { approvalMode: "auto" }, limits });
    bench.network.holdBelow(52_000_000n);
    const intent = await proposeAuto(bench);
    await flush();
    await goManual(bench);
    await driveUntil(bench, intent, { states: [], blocks: 18 });
    expect(eventsOf(bench)).toContain("executor.step_stopped:authorization_lapsed");
    expect(bench.signed).toHaveLength(1);
    expect(await stateOf(bench, intent)).toBe("executing");
  });

  it("speeds up no stuck step once its confirmation expired", async () => {
    const bench = await startExecutorBench({ limits });
    bench.network.holdBelow(52_000_000n);
    const intent = await tapped(bench);
    await flush();
    await bench.test.clock.advance(60_000);
    await driveUntil(bench, intent, { states: [], blocks: 18 });
    expect(eventsOf(bench)).toContain("executor.step_stopped:authorization_lapsed");
    expect(bench.signed).toHaveLength(1);
  });
});
