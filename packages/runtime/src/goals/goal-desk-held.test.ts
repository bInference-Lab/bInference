import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createMemoryGoalStore } from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createGoalDesk } from "./goal-desk.js";

const goal = {
  sessionId: nthTestId("ses", 1),
  agentId: nthTestId("agt", 1),
  objective: "keep the gas topped up",
  status: "active" as const,
  spentMicros: 0n,
  goalTurns: 1,
  strikes: 0,
  startedAtMs: 1_000,
  updatedAtMs: 1_000,
  version: 1,
};

// The goal desk over a client whose `goal/continue` the engine refuses with this code.
async function deskRefusedWith(code: `${string}.${string}`) {
  const { stores, database } = await createMemoryAgentStores();
  const client = createFakeToolClient({
    "goal/continue": new BinferenceError({ code, message: `The engine says ${code}.` }),
  });
  return createGoalDesk({
    goals: createMemoryGoalStore(database),
    fence: stores.fence,
    client,
    clock: createManualClock(10_000),
  });
}

describe("a goal turn the engine refuses", () => {
  it.each(["agent.frozen", "safety.breaker"] as const)(
    "pauses the goal as frozen on %s",
    async (code) => {
      const desk = await deskRefusedWith(code);
      const at = { surface: "telegram" as const, outside: false };
      await expect(desk.request(goal, at, new AbortController().signal)).resolves.toBe("frozen");
    },
  );

  it("asks again later on any other refusal", async () => {
    const desk = await deskRefusedWith("engine.timeout");
    const at = { surface: "telegram" as const, outside: false };
    await expect(desk.request(goal, at, new AbortController().signal)).resolves.toBe("asked");
  });
});
