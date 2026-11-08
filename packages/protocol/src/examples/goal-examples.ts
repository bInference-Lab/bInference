import type { GoalOperationShapes } from "../operations/goal-operations.schema.js";
import { ids, type WireExample, type WireObject } from "./wire-values.js";

const goal: WireObject = {
  agent: ids.agent,
  session: ids.session,
  objective: "Find three tokens with steady volume this week and report them",
  status: "active",
  budgetUsdMicros: "5000000",
  spentUsdMicros: "1250000",
  goalTurns: 4,
  startedAt: 1_760_000_000_000,
  updatedAt: 1_760_000_600_000,
};

const note: WireObject = {
  agent: ids.agent,
  session: ids.session,
  markdown: "2 of 3 tokens found; checking the third one's risk.",
  plan: [
    { text: "Scan this week's volume", state: "done" },
    { text: "Check each token's risk", state: "doing" },
    { text: "Report to the owner", state: "todo" },
  ],
  updatedAt: 1_760_000_500_000,
};

/** Example calls of the goal operations (decision 0407). */
export const goalExamples: { readonly [N in keyof GoalOperationShapes]: WireExample } = {
  "goal/get": { args: { agent: ids.agent }, result: { goal, note } },
  "goal/set": {
    args: { agent: ids.agent, objective: goal["objective"] ?? "", budgetUsdMicros: "5000000" },
    result: { goal: { ...goal, spentUsdMicros: "0", goalTurns: 0 } },
  },
  "goal/change": {
    args: { agent: ids.agent, action: "pause" },
    result: { goal: { ...goal, status: "paused", pauseReason: "owner" }, note },
  },
  "goal/continue": {
    args: {
      agent: ids.agent,
      session: ids.session,
      surface: "telegram",
      text: "[binference: goal turn 5 of at most 50. Keep working on the goal.]",
      outsideContent: false,
    },
    result: {},
  },
  "goal/show": {
    args: { agent: ids.agent, session: ids.session, change: "note", goal, note },
    result: {},
  },
};
