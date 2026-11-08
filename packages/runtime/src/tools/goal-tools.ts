import { goalTextLimit, maxPlanSteps, planStepTextLimit } from "@binference/protocol";
import type { GoalRecord, PlanStep } from "@binference/store";
import { z } from "zod";
import type { GoalDesk, GoalRefusal } from "../goals/goal-desk.js";
import { goalLimits } from "../goals/goal-rules.js";
import { goalFactLine } from "../goals/goal-words.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import type { AgentToolParts } from "./tool-client.js";

/** What the goal tools run on: each chat's goal and progress note. */
export interface GoalToolParts {
  readonly desk: GoalDesk;
}

/** The args of `goal_set`: the objective, and a budget in dollars when the owner asked for one. */
interface SetArgs {
  readonly objective: string;
  readonly budgetUsd?: string;
}

/** The args of `goal_update`: the goal is complete, or blocked, with a short note. */
interface UpdateArgs {
  readonly status: "complete" | "blocked";
  readonly note?: string;
}

/** The args of `progress_note`: the whole note, replacing the chat's one. */
interface NoteArgs {
  readonly markdown?: string;
  readonly plan?: readonly PlanStep[];
}

// Dollars with at most six decimals, above zero.
const dollars = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;

const setArgs: z.ZodType<SetArgs> = z.strictObject({
  objective: z.string().trim().min(1).max(goalTextLimit),
  budgetUsd: z
    .string()
    .regex(dollars)
    .refine((text) => /[1-9]/.test(text), { message: "A budget is above zero." })
    .exactOptional(),
});

const updateArgs: z.ZodType<UpdateArgs> = z.strictObject({
  status: z.enum(["complete", "blocked"]),
  note: z.string().trim().min(1).max(goalTextLimit).exactOptional(),
});

const noteArgs: z.ZodType<NoteArgs> = z.strictObject({
  markdown: z.string().max(goalTextLimit).exactOptional(),
  plan: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(planStepTextLimit),
        state: z.enum(["done", "doing", "todo"]),
      }),
    )
    .max(maxPlanSteps)
    .exactOptional(),
});

/** Micro-dollars of a dollar amount with at most six decimals. */
function microsOf(usd: string): bigint {
  const [whole = "0", part = ""] = usd.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(part.padEnd(6, "0"));
}

const refusals: Readonly<Record<GoalRefusal, string>> = {
  exists:
    "Refused: this chat already has a goal. Only the owner can clear it, with /goal clear; tell them, and do not try again.",
  none: "Refused: this chat has no goal. Do not try again; answer the owner.",
  no_session: "Refused: this chat is not open yet. Answer the owner instead.",
  done: "Refused: the goal is already complete. Do not try again; give the owner your answer.",
};

function refused(refusal: GoalRefusal): ToolOutcome {
  return { text: refusals[refusal], isError: true };
}

function goalText(goal: GoalRecord): string {
  return goalFactLine(goal).replace(/^- /, "");
}

function setTool(parts: AgentToolParts, goals: GoalToolParts): AgentTool {
  return defineTool({
    name: "goal_set",
    kind: "control",
    description: agentToolTexts.goal_set,
    args: setArgs,
    run: async ({ objective, budgetUsd }, { signal, turnState }) => {
      if (turnState().outside) {
        return {
          text: "Refused: this turn read outside content, so a goal set now might not be the owner's. Ask the owner to set it with /goal and the objective.",
          isError: true,
        };
      }
      const chat = { agent: parts.agent, session: parts.turn.session };
      const budget = budgetUsd === undefined ? {} : { budgetMicros: microsOf(budgetUsd) };
      const set = await goals.desk.set({ ...chat, objective, ...budget }, signal);
      if (!set.ok) {
        return refused(set.error);
      }
      return {
        text: `Goal set: ${goalText(set.value)} binference starts the next goal turn after this one ends, up to ${String(goalLimits.maxGoalTurns)}. Tell the owner in a line, and start on it now.`,
        isError: false,
      };
    },
  });
}

function readTool(parts: AgentToolParts, goals: GoalToolParts): AgentTool {
  return defineTool({
    name: "goal_read",
    kind: "read",
    parallel: true,
    forHelpers: false,
    description: agentToolTexts.goal_read,
    args: z.strictObject({}),
    run: async (_args, { signal }) => {
      const { goal, note } = await goals.desk.read(parts.turn.session, signal);
      const goalPart = goal === undefined ? "This chat has no goal." : goalText(goal);
      const notePart = goal?.note === undefined ? "" : `\nLast note on it: ${goal.note}`;
      const steps = (note?.plan ?? []).map((step) => `- [${step.state}] ${step.text}`);
      const progress =
        note === undefined
          ? "\nNo progress note."
          : `\nProgress note:\n${note.markdown}\n${steps.join("\n")}`;
      return { text: `${goalPart}${notePart}${progress}`.trimEnd(), isError: false };
    },
  });
}

function updateTool(parts: AgentToolParts, goals: GoalToolParts): AgentTool {
  return defineTool({
    name: "goal_update",
    kind: "control",
    description: agentToolTexts.goal_update,
    args: updateArgs,
    run: async ({ status, note }, { signal }) => {
      const chat = { agent: parts.agent, session: parts.turn.session };
      const move = { to: status, ...(note === undefined ? {} : { note }) };
      const moved = await goals.desk.move(chat, move, signal);
      if (!moved.ok) {
        return refused(moved.error);
      }
      return {
        text: `The goal is ${status} now; no goal turn follows. This told the owner nothing: give them your answer now, with what was done${status === "blocked" ? " and what you need from them" : ""}.`,
        isError: false,
      };
    },
  });
}

function noteTool(parts: AgentToolParts, goals: GoalToolParts): AgentTool {
  return defineTool({
    name: "progress_note",
    kind: "control",
    description: agentToolTexts.progress_note,
    args: noteArgs,
    run: async ({ markdown = "", plan = [] }, { signal }) => {
      const chat = { agent: parts.agent, session: parts.turn.session };
      const { note } = await goals.desk.read(chat.session, signal);
      const isNew = note === undefined && (markdown !== "" || plan.length > 0);
      if (isNew && plan.length < 2) {
        return {
          text: "Refused: a progress note is for work of two or more steps; give a plan of at least two, or keep working without one.",
          isError: true,
        };
      }
      const put = await goals.desk.putNote({ ...chat, markdown, plan }, signal);
      if (!put.ok) {
        return refused(put.error);
      }
      const done = plan.filter((step) => step.state === "done").length;
      const text =
        put.value === undefined
          ? "Progress note cleared."
          : `Progress note updated: ${String(done)} of ${String(plan.length)} steps done. The owner sees it beside the chat; do not repeat it in your answer.`;
      return { text, isError: false };
    },
  });
}

/**
 * The goal tools (decision 0407): `goal_set`, on the owner's explicit request in this chat and
 * never from a turn that read outside content; `goal_read`; `goal_update`, which marks the goal
 * complete or blocked; and `progress_note`, the chat's one status of substantial work, replaced
 * whole. No helper may call any of them.
 */
export function goalTools(parts: AgentToolParts, goals: GoalToolParts): readonly AgentTool[] {
  return [
    setTool(parts, goals),
    readTool(parts, goals),
    updateTool(parts, goals),
    noteTool(parts, goals),
  ];
}
