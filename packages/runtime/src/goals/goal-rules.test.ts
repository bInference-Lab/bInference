import type { GoalRecord } from "@binference/store";
import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { type GoalTurnEnd, moveGoal, stepAfterTurn } from "./goal-rules.js";

const goal: GoalRecord = {
  sessionId: nthTestId("ses", 1),
  agentId: nthTestId("agt", 1),
  objective: "Find three tokens",
  status: "active",
  spentMicros: 100n,
  goalTurns: 3,
  strikes: 0,
  startedAtMs: 1_000,
  updatedAtMs: 1_000,
  version: 4,
};

const worked: GoalTurnEnd = {
  goalTurn: true,
  outcome: "ok",
  budgetSpent: false,
  toolCalls: 2,
  spentMicros: 50n,
  atMs: 9_000,
};

describe("stepAfterTurn", () => {
  it("counts a goal turn that worked and asks for the next one at once", () => {
    expect(stepAfterTurn(goal, worked)).toStrictEqual({
      next: {
        status: "active",
        spentMicros: 150n,
        goalTurns: 4,
        strikes: 0,
        updatedAtMs: 9_000,
      },
      after: "continue",
    });
  });

  it("waits a minute after a goal turn that called no tool, and counts a strike", () => {
    const step = stepAfterTurn(goal, { ...worked, toolCalls: 0 });
    expect([step.next.strikes, step.after]).toStrictEqual([1, { waitMs: 60_000 }]);
  });

  it("counts a strike for a goal turn whose tool failed or that failed, and an owner's turn clears them", () => {
    const struck = { ...goal, strikes: 1 };
    expect(stepAfterTurn(struck, { ...worked, failedTool: "chart" }).next.strikes).toBe(2);
    expect(stepAfterTurn(struck, { ...worked, outcome: "loop" }).next.strikes).toBe(2);
    const owner = stepAfterTurn(struck, { ...worked, goalTurn: false, toolCalls: 0 });
    expect([owner.next.strikes, owner.next.goalTurns, owner.after]).toStrictEqual([
      0,
      3,
      "continue",
    ]);
  });

  it.each([
    ["the day's model budget", { ...goal }, { ...worked, budgetSpent: true }, "budget"],
    ["a turn that spent the budget", { ...goal }, { ...worked, outcome: "budget" }, "budget"],
    ["the goal's own budget", { ...goal, budgetMicros: 150n }, worked, "goal_budget"],
    ["its 50 goal turns", { ...goal, goalTurns: 49 }, worked, "turn_limit"],
    [
      "three goal turns with no progress",
      { ...goal, strikes: 2 },
      { ...worked, toolCalls: 0 },
      "no_progress",
    ],
  ] as const)("pauses at %s, and asks for no goal turn", (...[, before, ended, reason]) => {
    const step = stepAfterTurn(before, ended);
    expect(step).toMatchObject({
      next: { status: "paused", pauseReason: reason },
      change: "paused",
      after: "stop",
    });
  });

  it("starts no goal turn after a stopped or refused turn, and counts nothing a refused one did", () => {
    expect(stepAfterTurn(goal, { ...worked, outcome: "stopped" }).after).toBe("stop");
    const refused = stepAfterTurn(goal, { ...worked, outcome: "refused", spentMicros: 0n });
    expect([refused.after, refused.next.goalTurns]).toStrictEqual(["stop", 3]);
  });

  it("only counts on a goal that is not active", () => {
    const paused = { ...goal, status: "paused", pauseReason: "owner" } as const;
    expect(stepAfterTurn(paused, worked)).toMatchObject({
      next: { status: "paused", spentMicros: 150n },
      after: "stop",
    });
  });
});

describe("moveGoal", () => {
  it("pauses an active goal for the owner, and leaves a paused one as it is", () => {
    const paused = moveGoal(goal, { to: "pause", reason: "owner" }, 5_000);
    expect(paused).toMatchObject({ ok: true, value: { change: "paused" } });
    const again = { ...goal, status: "paused", pauseReason: "stopped" } as const;
    expect(moveGoal(again, { to: "pause", reason: "owner" }, 5_000)).toStrictEqual({
      ok: true,
      value: {
        next: {
          status: "paused",
          pauseReason: "stopped",
          spentMicros: 100n,
          goalTurns: 3,
          strikes: 0,
          updatedAtMs: 5_000,
        },
      },
    });
  });

  it("resumes a goal with its strikes cleared and the limit it paused on counted anew", () => {
    const limited = { ...goal, status: "paused", pauseReason: "goal_budget", strikes: 2 } as const;
    expect(moveGoal(limited, { to: "resume" }, 5_000)).toMatchObject({
      ok: true,
      value: {
        next: { status: "active", strikes: 0, spentMicros: 0n, goalTurns: 3 },
        change: "resumed",
      },
    });
    const turns = { ...goal, status: "paused", pauseReason: "turn_limit", goalTurns: 50 } as const;
    expect(moveGoal(turns, { to: "resume" }, 5_000)).toMatchObject({
      value: { next: { goalTurns: 0, spentMicros: 100n } },
    });
  });

  it("completes or blocks a goal with the agent's note, and moves a complete one no more", () => {
    const done = moveGoal(goal, { to: "complete", note: "Three found." }, 5_000);
    expect(done).toMatchObject({
      ok: true,
      value: { next: { status: "complete", note: "Three found." }, change: "complete" },
    });
    const complete = { ...goal, status: "complete" } as const;
    expect(moveGoal(complete, { to: "resume" }, 5_000)).toStrictEqual({ ok: false, error: "done" });
    expect(moveGoal(goal, { to: "blocked" }, 5_000)).toMatchObject({
      value: { change: "blocked" },
    });
  });
});
