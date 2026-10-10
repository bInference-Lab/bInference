import type { Clock } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { waitForEngine } from "./wait-for-engine.js";

type EngineStatus = ResultOf<"engine/status">;

// Time moves only when the wait sleeps, and each sleep returns at once.
function steppingClock(): Clock {
  const now = { ms: 0 };
  return {
    now: () => now.ms,
    sleep: async (delayMs) => {
      now.ms += delayMs;
      await Promise.resolve();
    },
  };
}

function status(state: EngineStatus["state"]): EngineStatus {
  return {
    version: "2026.10.0",
    protocol: 1,
    state,
    frozen: false,
    agents: [],
    health: [],
  };
}

// Answers each ask with the next of the answers, then the last one again.
function answering(answers: readonly (EngineStatus | undefined)[]) {
  const asked = { count: 0 };
  const ask = async () => {
    asked.count += 1;
    return Promise.resolve(answers[Math.min(asked.count, answers.length) - 1]);
  };
  return { ask, asked };
}

const wait = () => ({
  clock: steppingClock(),
  budgetMs: 1_000,
  signal: new AbortController().signal,
});

describe("waitForEngine", () => {
  it("answers the first status past starting", async () => {
    const { ask, asked } = answering([undefined, status("starting"), status("ready")]);
    await expect(waitForEngine(ask, wait())).resolves.toMatchObject({ state: "ready" });
    expect(asked.count).toBe(3);
  });

  it("answers nothing once the budget passes with no answer, asking every 250 ms", async () => {
    const { ask, asked } = answering([undefined]);
    await expect(waitForEngine(ask, wait())).resolves.toBeUndefined();
    expect(asked.count).toBe(5);
  });

  it("answers starting when the engine never got further", async () => {
    const { ask } = answering([status("starting"), undefined]);
    await expect(waitForEngine(ask, wait())).resolves.toMatchObject({ state: "starting" });
  });
});
