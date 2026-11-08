import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/**
 * Where a helper stands (decision 0403): its run goes on, or it ended with its answer, with a
 * failure, by a stop or at its time limit.
 */
export type HelperState = "running" | "done" | "failed" | "stopped" | "timed_out";

/**
 * A helper the agent started: a session of its own, under the agent that started it, which works
 * on one task in the background and reports to the agent.
 */
export interface HelperRecord {
  /** The helper's own session (`ses_…`), which is its id too. */
  readonly id: Id<"ses">;
  readonly agentId: Id<"agt">;
  /** The agent's session the helper was started from. */
  readonly parentSessionId: Id<"ses">;
  /** A short title the agent gave it. */
  readonly label: string;
  /** The model the agent named for it, as `<provider>/<model>`; absent, the agent's own. */
  readonly model?: string;
  readonly state: HelperState;
  /** When its latest run started. */
  readonly startedAtMs: number;
  /** When its latest run ended; absent while it runs. */
  readonly endedAtMs?: number;
  /** Its latest run's time limit. */
  readonly timeoutMs: number;
  /** How many runs it had: the first, and one for each follow-up. */
  readonly runs: number;
  /** Its session read outside content at some point: the mark never clears. */
  readonly outside: boolean;
}

/** A helper as it starts: its first run begins with it. */
export type HelperDraft = Pick<
  HelperRecord,
  "id" | "agentId" | "parentSessionId" | "label" | "startedAtMs" | "timeoutMs"
> & { readonly model?: string };

/**
 * A move of a helper from the state its mover read: an end of a running helper, with whether its
 * run read outside content, or a new run of one that ended, with that run's time limit.
 */
export interface HelperMove {
  readonly helper: Id<"ses">;
  readonly from: HelperState;
  readonly to: HelperState;
  readonly atMs: number;
  /** The new run's time limit; only with a move to `running`. */
  readonly timeoutMs?: number;
  /** The run that ends read outside content; only with a move out of `running`. */
  readonly outside?: boolean;
}

/** Which helpers to list: one agent's, those in one state, or both; newest first. */
export interface HelperQuery {
  readonly agentId?: Id<"agt">;
  readonly state?: HelperState;
  readonly limit: number;
}

const epochMs = z.int().nonnegative();
const stateSchema = z.enum(["running", "done", "failed", "stopped", "timed_out"]);
const labelSchema = z.string().min(1).max(60);
const modelSchema = z.string().min(1).max(200);
const timeoutSchema = z.int().positive();

/** Parses a helper record. */
export const helperRecordSchema: z.ZodType<HelperRecord> = z.strictObject({
  id: idSchema("ses"),
  agentId: idSchema("agt"),
  parentSessionId: idSchema("ses"),
  label: labelSchema,
  model: modelSchema.exactOptional(),
  state: stateSchema,
  startedAtMs: epochMs,
  endedAtMs: epochMs.exactOptional(),
  timeoutMs: timeoutSchema,
  runs: z.int().positive(),
  outside: z.boolean(),
});

/** Parses a fenced helper draft. */
export const helperDraftSchema: z.ZodType<Fenced<HelperDraft>> = z.strictObject({
  id: idSchema("ses"),
  agentId: idSchema("agt"),
  parentSessionId: idSchema("ses"),
  label: labelSchema,
  model: modelSchema.exactOptional(),
  startedAtMs: epochMs,
  timeoutMs: timeoutSchema,
  fence: fenceSchema,
});

/** Parses a fenced helper move: a run starts only from an end, and ends only from `running`. */
export const helperMoveSchema: z.ZodType<Fenced<HelperMove>> = z
  .strictObject({
    helper: idSchema("ses"),
    from: stateSchema,
    to: stateSchema,
    atMs: epochMs,
    timeoutMs: timeoutSchema.exactOptional(),
    outside: z.boolean().exactOptional(),
    fence: fenceSchema,
  })
  .refine((move) => (move.from === "running") !== (move.to === "running"), {
    message: "A helper moves from running to an end, or from an end to running.",
  })
  .refine((move) => (move.to === "running") === (move.timeoutMs !== undefined), {
    message: "A new run, and only a new run, names its time limit.",
  })
  .refine((move) => move.to !== "running" || move.outside === undefined, {
    message: "Only an end says whether its run read outside content.",
  });

/** Parses a helper query. */
export const helperQuerySchema: z.ZodType<HelperQuery> = z.strictObject({
  agentId: idSchema("agt").exactOptional(),
  state: stateSchema.exactOptional(),
  limit: z.int().positive().max(1_000),
});
