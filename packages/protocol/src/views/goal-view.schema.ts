import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** The most characters of a goal's objective, of a note on it, and of a progress note. */
export const goalTextLimit: number = 2_000;

/** The most steps of a progress note's plan. */
export const maxPlanSteps: number = 12;

/** The most characters of one step of a progress note's plan. */
export const planStepTextLimit: number = 200;

/** Where a chat's goal stands (decision 0407). */
export type GoalStatus = "active" | "paused" | "blocked" | "complete";

/**
 * Why a goal paused: the owner paused it, stopped the agent or froze it, a limit ran out (the
 * day's model budget, the goal's own budget, its 50 goal turns), its goal turns made no progress
 * three times in a row.
 */
export type GoalPauseReason =
  | "owner"
  | "stopped"
  | "frozen"
  | "budget"
  | "goal_budget"
  | "turn_limit"
  | "no_progress";

/** The pause reasons, in the order the protocol spec lists them. */
export const goalPauseReasons: readonly GoalPauseReason[] = [
  "owner",
  "stopped",
  "frozen",
  "budget",
  "goal_budget",
  "turn_limit",
  "no_progress",
];

/** A chat's goal, as every surface shows it. */
export interface GoalView {
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly objective: string;
  readonly status: GoalStatus;
  /** Why it paused; present exactly while it is `paused`. */
  readonly pauseReason?: GoalPauseReason;
  /** The agent's note when it completed or blocked the goal. */
  readonly note?: string;
  /** The most its turns may spend, in micro-dollars. */
  readonly budgetUsdMicros?: bigint;
  /** What the chat's model calls spent since the goal was set, in micro-dollars. */
  readonly spentUsdMicros: bigint;
  /** The goal turns binference started for it, at most 50. */
  readonly goalTurns: number;
  readonly startedAt: number;
  readonly updatedAt: number;
}

/** Where a step of a progress note's plan stands. */
export type PlanStepState = "done" | "doing" | "todo";

/** One step of a progress note's plan. */
export interface PlanStepView {
  readonly text: string;
  readonly state: PlanStepState;
}

/** A chat's progress note: the agent's one status of substantial work (decision 0407). */
export interface ProgressNoteView {
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  /** A short markdown; empty when the plan says it all. */
  readonly markdown: string;
  readonly plan: readonly PlanStepView[];
  readonly updatedAt: number;
}

/** Parses a goal's status. */
export const goalStatusSchema: z.ZodType<GoalStatus, string> = z.enum([
  "active",
  "paused",
  "blocked",
  "complete",
]);

/** Parses why a goal paused. */
export const goalPauseReasonSchema: z.ZodType<GoalPauseReason, string> = z.enum([
  "owner",
  "stopped",
  "frozen",
  "budget",
  "goal_budget",
  "turn_limit",
  "no_progress",
]);

/** Parses a goal. */
export const goalViewSchema: z.ZodType<GoalView> = z.object({
  agent: protocolIdSchema("agent"),
  session: protocolIdSchema("chatSession"),
  objective: z.string().min(1).max(goalTextLimit),
  status: goalStatusSchema,
  pauseReason: goalPauseReasonSchema.exactOptional(),
  note: z.string().min(1).max(goalTextLimit).exactOptional(),
  budgetUsdMicros: decimalStringSchema.exactOptional(),
  spentUsdMicros: decimalStringSchema,
  goalTurns: z.int().nonnegative(),
  startedAt: epochMsSchema,
  updatedAt: epochMsSchema,
});

/** Parses a step of a progress note's plan. */
export const planStepViewSchema: z.ZodType<PlanStepView> = z.object({
  text: z.string().min(1).max(planStepTextLimit),
  state: z.enum(["done", "doing", "todo"]),
});

/** Parses a progress note. */
export const progressNoteViewSchema: z.ZodType<ProgressNoteView> = z.object({
  agent: protocolIdSchema("agent"),
  session: protocolIdSchema("chatSession"),
  markdown: z.string().max(goalTextLimit),
  plan: z.array(planStepViewSchema).max(maxPlanSteps),
  updatedAt: epochMsSchema,
});
