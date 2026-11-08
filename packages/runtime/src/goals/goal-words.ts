import { createFormatter } from "@binference/i18n";
import type { GoalRecord } from "@binference/store";
import { goalLimits } from "./goal-rules.js";

const usd = createFormatter({ locale: "en", timeZone: "UTC" }).usd;

// The objective on one line, as the agent reads it inside binference's words.
function objectiveOf(goal: GoalRecord): string {
  return JSON.stringify(goal.objective.replaceAll(/\s+/g, " ").trim());
}

/**
 * The words binference writes in the owner's place to start a chat's next goal turn (decision
 * 0407): which goal turn of at most 50 it is, the objective, and how to work on it.
 */
export function goalTurnText(goal: GoalRecord): string {
  const turn = String(goal.goalTurns + 1);
  const most = String(goalLimits.maxGoalTurns);
  return `[binference: goal turn ${turn} of at most ${most}. Keep working on this chat's goal, ${objectiveOf(goal)}: take the next step, keep the progress note current with progress_note, and mark the goal complete with goal_update only once the whole objective is verified done. These are binference's words, not the owner's.]`;
}

/**
 * The goal's line in each model call's live facts (decision 0407): its status, objective, goal
 * turns and spend, and how to treat it.
 */
export function goalFactLine(goal: GoalRecord): string {
  const budget = goal.budgetMicros === undefined ? "" : ` of its ${usd(goal.budgetMicros)} budget`;
  const counts = `${String(goal.goalTurns)} of at most ${String(goalLimits.maxGoalTurns)} goal turns, ${usd(goal.spentMicros)} spent${budget}`;
  const head = `- Goal of this chat (${goal.status}): ${objectiveOf(goal)}; ${counts}.`;
  return goal.status === "active"
    ? `${head} Advance it; keep it active until fully achieved; mark it blocked only after the same blocker on 3 goal turns in a row; answer the owner's own messages first.`
    : head;
}
