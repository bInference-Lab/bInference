import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { goalChangeLine, goalLines, progressNoteLines } from "./goal-lines.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const session = protocolIdSchema("chatSession").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const goal = {
  agent,
  session,
  objective: "Find three tokens",
  status: "active",
  spentUsdMicros: 1_250_000n,
  budgetUsdMicros: 5_000_000n,
  goalTurns: 4,
  startedAt: 1,
  updatedAt: 2,
} as const;

describe("goal lines", () => {
  it("tells each change of a goal in one status line, and nothing for a note alone", () => {
    expect(goalChangeLine("set", goal, formatter)).toBe(
      "Goal set: Find three tokens. The agent works on it turn after turn; /goal pause stops it.",
    );
    const paused = { ...goal, status: "paused", pauseReason: "goal_budget" } as const;
    expect(goalChangeLine("paused", paused, formatter)).toBe(
      "Goal paused: it spent its budget of $5.00. /goal resume gives it the same budget again.",
    );
    const done = { ...goal, status: "complete", note: "Three found." } as const;
    expect(goalChangeLine("complete", done, formatter)).toBe(
      "Goal complete: Find three tokens\nAgent's note: Three found.",
    );
    expect(goalChangeLine("cleared", undefined, formatter)).toBe("Goal cleared.");
    expect(goalChangeLine("note", goal, formatter)).toBeUndefined();
  });

  it("reads a goal for /goal, and says how to set one when the chat has none", () => {
    expect(goalLines(goal, formatter)).toStrictEqual([
      "Goal (active): Find three tokens",
      "Goal turns: 4 of at most 50.",
      "Spent: $1.25 of $5.00.",
      "/goal pause, /goal resume, /goal clear",
    ]);
    expect(goalLines(undefined, formatter)).toStrictEqual([
      "No goal in this chat. Set one with /goal and what the agent should achieve.",
    ]);
  });

  it("shows a progress note with its markdown and each step in order", () => {
    const note = {
      agent,
      session,
      markdown: "2 of 3 found.",
      plan: [
        { text: "Scan", state: "done" },
        { text: "Check risk", state: "doing" },
      ],
      updatedAt: 3,
    } as const;
    expect(progressNoteLines(note, formatter)).toStrictEqual([
      "Progress note",
      "2 of 3 found.",
      "1. Scan (done)",
      "2. Check risk (in progress)",
    ]);
  });
});
