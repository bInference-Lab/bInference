import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type ScheduleRun,
  scheduleRunSchema,
  type ScheduleSkip,
  scheduleSkips,
  type ScheduleState,
  scheduleStates,
  type ScheduleWhen,
  scheduleWhenSchema,
} from "@binference/protocol";
import { z } from "zod";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";

/** The most active schedules one agent holds (decision 0233). */
export const maxActiveSchedules = 50;

/** The longest prompt a schedule keeps, in characters (decision 0233). */
const maxSchedulePrompt = 2_000;

/** One schedule as the store keeps it (database spec, `schedules`). */
export interface ScheduleRecord {
  readonly id: Id<"sch">;
  readonly agentId: Id<"agt">;
  readonly when: ScheduleWhen;
  readonly prompt: string;
  readonly state: ScheduleState;
  /** The next run, while it is `active`. */
  readonly nextAtMs?: number;
  /**
   * The IANA zone `nextAtMs` was worked out in: the schedule's own, or `owner.timezone` at the
   * time for one that names none. A schedule that runs `at` one time has none.
   */
  readonly zone?: string;
  /** The credential or surface that set it: a client token's id, or `telegram`. */
  readonly createdBy: string;
  /** Set in a turn that held outside content, or by an outside client: its turns start marked. */
  readonly outsideContent: boolean;
  readonly lastRun?: ScheduleRun;
  /** The wake-up the last sent run stored, so a newer run never adds a second one. */
  readonly lastMessageId?: Id<"msg">;
  readonly createdAtMs: number;
  readonly changedAtMs: number;
}

/** Parses a schedule as a store keeps it. */
export const scheduleRecordSchema: z.ZodType<ScheduleRecord> = z.strictObject({
  id: idSchema("sch"),
  agentId: idSchema("agt"),
  when: scheduleWhenSchema,
  prompt: z.string().min(1).max(maxSchedulePrompt),
  state: z.enum(scheduleStates),
  nextAtMs: epochMsSchema.exactOptional(),
  zone: shortTextSchema.exactOptional(),
  createdBy: shortTextSchema,
  outsideContent: z.boolean(),
  lastRun: scheduleRunSchema.exactOptional(),
  lastMessageId: idSchema("msg").exactOptional(),
  createdAtMs: epochMsSchema,
  changedAtMs: epochMsSchema,
});

/** Which active schedules to list: one agent's, or every agent's. */
export interface ScheduleQuery {
  readonly agentId?: Id<"agt">;
}

/** Parses a schedule query. */
export const scheduleQuerySchema: z.ZodType<ScheduleQuery> = z.strictObject({
  agentId: idSchema("agt").exactOptional(),
});

/** The active schedules whose next run came by `atMs`, the earliest first, at most `limit`. */
export interface DueQuery {
  readonly atMs: number;
  readonly limit: number;
}

/** Parses a due query. */
export const dueQuerySchema: z.ZodType<DueQuery> = z.strictObject({
  atMs: epochMsSchema,
  limit: z.int().min(1).max(1_000),
});

/** A cancel of an active schedule, at a time. */
export interface ScheduleCancel {
  readonly id: Id<"sch">;
  readonly atMs: number;
}

/** Parses a cancel. */
export const scheduleCancelSchema: z.ZodType<ScheduleCancel> = z.strictObject({
  id: idSchema("sch"),
  atMs: epochMsSchema,
});

/** A schedule's next run, and the zone it was worked out in. */
export interface ScheduleNext {
  readonly nextAtMs: number;
  readonly zone?: string;
}

const nextSchema: z.ZodType<ScheduleNext> = z.strictObject({
  nextAtMs: epochMsSchema,
  zone: shortTextSchema.exactOptional(),
});

/**
 * A new next run for an active schedule whose zone changed, kept only while its next run is still
 * `expectedNextAtMs`, so a run that landed first wins.
 */
export interface ScheduleRezone extends ScheduleNext {
  readonly id: Id<"sch">;
  readonly expectedNextAtMs: number;
  readonly atMs: number;
}

/** Parses a rezone. */
export const scheduleRezoneSchema: z.ZodType<ScheduleRezone> = z.strictObject({
  id: idSchema("sch"),
  expectedNextAtMs: epochMsSchema,
  nextAtMs: epochMsSchema,
  zone: shortTextSchema.exactOptional(),
  atMs: epochMsSchema,
});

/** The wake-up a run stores when it starts a turn (runtime spec, section 3.3). */
export interface ScheduleWake {
  readonly id: Id<"msg">;
  readonly turnId: Id<"trn">;
  /** The session the message opens when its agent has none open. */
  readonly opens: Id<"ses">;
  /** The `inbox/scheduleDue` fields: the schedule, its prompt, its due time and its mark. */
  readonly payload: JsonValue;
}

/**
 * One run of a schedule that was due at `dueAtMs`: it stores the wake-up unless the engine
 * skipped it for `skip`, then moves the schedule to `next`, or ends it when there is none. The run
 * lands only while the schedule is active and still due at `dueAtMs`.
 */
export interface ScheduleRunDraft {
  readonly id: Id<"sch">;
  readonly dueAtMs: number;
  readonly atMs: number;
  readonly skip?: ScheduleSkip;
  readonly wake: ScheduleWake;
  readonly next?: ScheduleNext;
}

/** Parses a run draft. */
export const scheduleRunDraftSchema: z.ZodType<ScheduleRunDraft> = z.strictObject({
  id: idSchema("sch"),
  dueAtMs: epochMsSchema,
  atMs: epochMsSchema,
  skip: z.enum(scheduleSkips).exactOptional(),
  wake: z.strictObject({
    id: idSchema("msg"),
    turnId: idSchema("trn"),
    opens: idSchema("ses"),
    payload: jsonValueSchema,
  }),
  next: nextSchema.exactOptional(),
});

/** What one run wrote: the schedule after it, and the wake-up it stored when it started a turn. */
export interface ScheduleRunWritten {
  readonly schedule: ScheduleRecord;
  readonly message?: AgentInboxMessage;
}
