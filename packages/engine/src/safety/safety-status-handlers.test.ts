import { accountRefSchema } from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import {
  rescueCustody,
  rescueSteps,
  secondAgent,
  setUpRescue,
  testHeld,
  testRescue,
} from "./test-rescue.js";

const live = { signal: new AbortController().signal };

async function startRescuing(): Promise<TestEngine> {
  const test = await startTestEngine({
    custodyWallets: rescueCustody,
    held: testHeld,
    chainSimulator: createFakeTxSimulator(rescueSteps()),
  });
  await setUpRescue(test);
  return test;
}

async function statusOf(test: TestEngine, caller = testCallers.cli) {
  return expectOk(await test.engine.handlers["safety/status"](testCall({}, caller)));
}

describe("safety/status", () => {
  it("answers that nothing is frozen and no rescue address is set on a new install", async () => {
    const test = await startTestEngine();
    await expect(statusOf(test)).resolves.toStrictEqual({ frozen: false, agents: [] });
  });

  it("lists each frozen agent with its time, and the install's freeze once it is whole", async () => {
    const test = await startRescuing();
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: secondAgent })));
    await expect(statusOf(test)).resolves.toMatchObject({
      frozen: true,
      agents: [{ agent: secondAgent, frozenAt: testNowMs }],
    });
    await test.clock.advance(5_000);
    expectOk(await test.engine.handlers["safety/freeze"](testCall({})));
    const status = await statusOf(test, testCallers.mcp);
    expect(status).toMatchObject({
      frozen: true,
      frozenAt: testNowMs + 5_000,
      agents: [
        { agent: testAgent, frozenAt: testNowMs + 5_000 },
        { agent: secondAgent, frozenAt: testNowMs },
      ],
    });
  });

  it("names the rescue under way, the rescue address in effect and a change that waits", async () => {
    const test = await startRescuing();
    const { intent } = expectOk(await test.engine.handlers["safety/rescue"](testCall({})));
    const other = accountRefSchema.parse("fake:1:0x000000b2");
    await test.stores.install.changeRescue({ address: other, atMs: test.clock.now() }, live);
    await expect(statusOf(test)).resolves.toStrictEqual({
      frozen: false,
      agents: [],
      rescue: { intent, state: "awaiting_confirmation" },
      rescueAddress: testRescue,
      pendingRescueAddress: other,
      pendingRescueAt: testNowMs + looseningWaitMs,
    });
  });
});
