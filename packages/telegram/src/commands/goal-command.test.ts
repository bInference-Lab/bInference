import { err, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { type GoalView, protocolIdSchema, type ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const session = protocolIdSchema("chatSession").parse("ses_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");

const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.11.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: agent, mode: "paper", frozen: false }],
  health: [],
};

const goal: GoalView = {
  agent,
  session,
  objective: "Find three tokens",
  status: "paused",
  pauseReason: "owner",
  spentUsdMicros: 250_000n,
  goalTurns: 2,
  startedAt: 1,
  updatedAt: 2,
};

// An engine with one agent that records each goal call and answers it.
function engine({ hasGoal }: { readonly hasGoal: boolean }) {
  const asked: (readonly [string, unknown])[] = [];
  const handlers: Partial<OwnerChatHandlers> = {
    "engine/status": async () => Promise.resolve(ok(status)),
    "goal/get": async () =>
      Promise.resolve(
        ok(
          hasGoal
            ? {
                goal,
                note: {
                  agent,
                  session,
                  markdown: "1 of 3 found.",
                  plan: [{ text: "Scan", state: "doing" }],
                  updatedAt: 2,
                },
              }
            : {},
        ),
      ),
    "goal/set": async ({ args }) => {
      asked.push(["goal/set", args.objective]);
      return Promise.resolve(hasGoal ? err("goal.exists") : ok({ goal }));
    },
    "goal/change": async ({ args }) => {
      asked.push(["goal/change", args.action]);
      return Promise.resolve(ok({ goal }));
    },
  };
  return { handlers, asked };
}

describe("the goal command", () => {
  it("reads the chat's goal and its progress note", async () => {
    const bot = await startCommandBot(engine({ hasGoal: true }).handlers);
    await bot.send("/goal");
    expect(bot.texts()).toStrictEqual([
      [
        "Goal (paused): Find three tokens",
        "Goal turns: 2 of at most 50.",
        "Spent: $0.25.",
        "Goal paused. /goal resume continues it.",
        "/goal pause, /goal resume, /goal clear",
        "",
        "Progress note",
        "1 of 3 found.",
        "1. Scan (in progress)",
      ].join("\n"),
    ]);
  });

  it("sets a goal from its words and changes it, saying nothing once each was taken", async () => {
    const fake = engine({ hasGoal: false });
    const bot = await startCommandBot(fake.handlers);
    await bot.send("/goal Find three tokens with steady volume");
    await bot.send("/goal pause");
    await bot.send("/goal Resume");
    await bot.send("/goal clear");
    expect(fake.asked).toStrictEqual([
      ["goal/set", "Find three tokens with steady volume"],
      ["goal/change", "pause"],
      ["goal/change", "resume"],
      ["goal/change", "clear"],
    ]);
    expect(bot.texts()).toStrictEqual([]);
  });

  it("answers a refusal with its error's words", async () => {
    const bot = await startCommandBot(engine({ hasGoal: true }).handlers);
    await bot.send("/goal Another goal");
    expect(bot.texts()).toStrictEqual([
      "This chat already has a goal. Clear it with /goal clear, then set the new one.",
    ]);
  });
});
