import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** When a schedule runs: on a cron expression, in an IANA zone or the owner's, or once `at`. */
export type ScheduleWhen =
  | { readonly cron: string; readonly timezone?: string }
  | { readonly at: number };

/** Every state of a schedule. */
export const scheduleStates = ["active", "cancelled", "ended"] as const;

/**
 * A schedule's state: `active` while it runs, `cancelled` once a client cancelled it, and `ended`
 * once a schedule that runs `at` one time ran, or one whose cron expression runs no more.
 */
export type ScheduleState = (typeof scheduleStates)[number];

/** Every reason a schedule's run starts no turn (decision 0232). */
export const scheduleSkips = ["frozen", "archived", "budget", "waiting", "busy"] as const;

/**
 * Why a run started no turn: the agent was frozen or archived, its model budget of the day was
 * spent, the schedule's last wake-up still waited for the agent, or the agent inbox was full.
 */
export type ScheduleSkip = (typeof scheduleSkips)[number];

/** A schedule's last run: when it was due, when it ran, and whether it woke the agent. */
export interface ScheduleRun {
  readonly due: number;
  readonly at: number;
  readonly outcome: "sent" | "skipped";
  /** Why a skipped run started no turn. */
  readonly reason?: ScheduleSkip;
}

/** A schedule: a model turn with `prompt` at set times. It moves no money. */
export interface ScheduleView {
  readonly schedule: ProtocolId<"schedule">;
  readonly agent: ProtocolId<"agent">;
  readonly when: ScheduleWhen;
  readonly prompt: string;
  readonly state: ScheduleState;
  readonly nextAt?: number;
  readonly lastAt?: number;
  readonly createdAt: number;
  readonly lastRun?: ScheduleRun;
  /**
   * Set in a turn that read outside content or by an outside client, so its prompt may hold outside
   * content and its turns start marked (decision 0247); the engine always sends it.
   */
  readonly outsideContent?: boolean;
}

const cronShape = {
  cron: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64).exactOptional(),
};

/** Parses when a schedule runs, as `schedule/create` takes it. Unknown fields are refused. */
export const scheduleWhenSchema: z.ZodType<ScheduleWhen> = z.union([
  z.strictObject(cronShape),
  z.strictObject({ at: epochMsSchema }),
]);

/** Parses a schedule's last run. */
export const scheduleRunSchema: z.ZodType<ScheduleRun> = z.object({
  due: epochMsSchema,
  at: epochMsSchema,
  outcome: z.enum(["sent", "skipped"]),
  reason: z.enum(scheduleSkips).exactOptional(),
});

/** Parses a schedule view. */
export const scheduleViewSchema: z.ZodType<ScheduleView> = z.object({
  schedule: protocolIdSchema("schedule"),
  agent: protocolIdSchema("agent"),
  when: z.union([z.object(cronShape), z.object({ at: epochMsSchema })]),
  prompt: z.string(),
  state: z.enum(scheduleStates),
  nextAt: epochMsSchema.exactOptional(),
  lastAt: epochMsSchema.exactOptional(),
  createdAt: epochMsSchema,
  lastRun: scheduleRunSchema.exactOptional(),
  outsideContent: z.boolean().exactOptional(),
});
