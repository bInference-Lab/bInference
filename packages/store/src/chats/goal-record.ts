import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/**
 * Where a chat's goal stands (decision 0407): the agent works on it, the owner or a limit paused
 * it, the agent found it blocked, or the agent found it complete.
 */
export type GoalStatus = "active" | "paused" | "blocked" | "complete";

/**
 * The goal of one chat: what the agent keeps working on, turn after turn, and how far it went.
 * A chat has at most one.
 */
export interface GoalRecord {
  /** The chat's session (`ses_…`), which is the goal's key. */
  readonly sessionId: Id<"ses">;
  readonly agentId: Id<"agt">;
  readonly objective: string;
  readonly status: GoalStatus;
  /** Why the goal paused, a short code; set exactly while it is `paused`. */
  readonly pauseReason?: string;
  /** The last note on the goal: the agent's when it completed or blocked it. */
  readonly note?: string;
  /** The most the goal's turns may spend, in micro-dollars; absent, only the daily budget caps it. */
  readonly budgetMicros?: bigint;
  /** What the chat's model calls spent since the goal was set, in micro-dollars. */
  readonly spentMicros: bigint;
  /** The goal turns binference started for it. */
  readonly goalTurns: number;
  /** Goal turns in a row that ended with a failed tool or no tool call at all. */
  readonly strikes: number;
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  /** Raised by every write, so a writer that read an older goal is refused. */
  readonly version: number;
}

/** A goal as it is set: it starts `active`, with nothing spent. */
export type GoalDraft = Pick<GoalRecord, "sessionId" | "agentId" | "objective" | "startedAtMs"> & {
  readonly budgetMicros?: bigint;
};

/** What a write of a goal may change: everything but its chat, objective, budget and start. */
export type GoalState = Pick<
  GoalRecord,
  "status" | "pauseReason" | "note" | "spentMicros" | "goalTurns" | "strikes" | "updatedAtMs"
>;

/** A write of a goal, from the version its writer read. */
export interface GoalWrite {
  readonly sessionId: Id<"ses">;
  readonly version: number;
  readonly next: GoalState;
}

/** Where a step of a progress note stands. */
export type PlanStepState = "done" | "doing" | "todo";

/** One step of a progress note's plan. */
export interface PlanStep {
  readonly text: string;
  readonly state: PlanStepState;
}

/**
 * The progress note of one chat (decision 0407): the one status of its work the owner reads
 * without the transcript, replaced whole each time.
 */
export interface ProgressNoteRecord {
  readonly sessionId: Id<"ses">;
  readonly agentId: Id<"agt">;
  /** A short markdown, at most 2,000 characters; may be empty when the plan says it all. */
  readonly markdown: string;
  /** The steps of the work, in order, at most 12. */
  readonly plan: readonly PlanStep[];
  readonly updatedAtMs: number;
}

/** The most characters of a goal's objective, of a note on it and of a progress note. */
export const goalTextLimit = 2_000;

/** The most steps a progress note's plan holds. */
export const maxPlanSteps = 12;

const epochMs = z.int().nonnegative();
const statusSchema = z.enum(["active", "paused", "blocked", "complete"]);
const textSchema = z.string().min(1).max(goalTextLimit);
const reasonSchema = z.string().min(1).max(40);
const count = z.int().nonnegative();

/** Parses a plan step. */
const planStepSchema: z.ZodType<PlanStep> = z.strictObject({
  text: z.string().min(1).max(200),
  state: z.enum(["done", "doing", "todo"]),
});

const stateShape = {
  status: statusSchema,
  pauseReason: reasonSchema.exactOptional(),
  note: textSchema.exactOptional(),
  spentMicros: z.bigint().nonnegative(),
  goalTurns: count,
  strikes: count,
  updatedAtMs: epochMs,
};

// A goal is paused exactly while it holds why.
const pausedWithReason = (goal: { readonly status: string; readonly pauseReason?: string }) =>
  (goal.status === "paused") === (goal.pauseReason !== undefined);
const pausedRule = { message: "A goal holds why it paused exactly while it is paused." };

/** Parses a goal record. */
export const goalRecordSchema: z.ZodType<GoalRecord> = z
  .strictObject({
    sessionId: idSchema("ses"),
    agentId: idSchema("agt"),
    objective: textSchema,
    budgetMicros: z.bigint().positive().exactOptional(),
    startedAtMs: epochMs,
    version: count,
    ...stateShape,
  })
  .refine(pausedWithReason, pausedRule);

/** Parses a fenced goal draft. */
export const goalDraftSchema: z.ZodType<Fenced<GoalDraft>> = z.strictObject({
  sessionId: idSchema("ses"),
  agentId: idSchema("agt"),
  objective: textSchema,
  budgetMicros: z.bigint().positive().exactOptional(),
  startedAtMs: epochMs,
  fence: fenceSchema,
});

/** Parses a fenced goal write. */
export const goalWriteSchema: z.ZodType<Fenced<GoalWrite>> = z.strictObject({
  sessionId: idSchema("ses"),
  version: count,
  next: z.strictObject(stateShape).refine(pausedWithReason, pausedRule),
  fence: fenceSchema,
});

/** Parses a fenced removal of a chat's goal. */
export const goalClearSchema: z.ZodType<Fenced<{ readonly sessionId: Id<"ses"> }>> = z.strictObject(
  { sessionId: idSchema("ses"), fence: fenceSchema },
);

/** Parses a progress note record. */
export const progressNoteRecordSchema: z.ZodType<ProgressNoteRecord> = z.strictObject({
  sessionId: idSchema("ses"),
  agentId: idSchema("agt"),
  markdown: z.string().max(goalTextLimit),
  plan: z.array(planStepSchema).max(maxPlanSteps),
  updatedAtMs: epochMs,
});

/** Parses a fenced progress note to put. */
export const progressNotePutSchema: z.ZodType<Fenced<ProgressNoteRecord>> = z.strictObject({
  sessionId: idSchema("ses"),
  agentId: idSchema("agt"),
  markdown: z.string().max(goalTextLimit),
  plan: z.array(planStepSchema).max(maxPlanSteps),
  updatedAtMs: epochMs,
  fence: fenceSchema,
});
