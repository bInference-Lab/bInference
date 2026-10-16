import type { Id, Result } from "@binference/core";
import type {
  DueQuery,
  ScheduleCancel,
  ScheduleQuery,
  ScheduleRecord,
  ScheduleRezone,
  ScheduleRunDraft,
  ScheduleRunWritten,
} from "./schedule-record.js";

/**
 * Keeps the owner's schedules and their runs (database spec, `schedules` and `schedule_runs`).
 * A run stores its `inbox/scheduleDue` message in the agent inbox in the same write, so a wake-up
 * and the record of it land together or not at all (runtime spec, section 3.2).
 */
export interface ScheduleStore {
  /**
   * Stores a new active schedule. An unknown agent is `not_found`, and one that holds 50 active
   * schedules `too_many`; either stores nothing. An id in use throws `store.constraint`.
   */
  create(
    schedule: ScheduleRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ScheduleRecord, "not_found" | "too_many">>;
  /** One schedule in any state, or `undefined` for an unknown id. */
  get(
    id: Id<"sch">,
    options: { readonly signal: AbortSignal },
  ): Promise<ScheduleRecord | undefined>;
  /** The active schedules, of one agent or every agent, oldest first, then by id. */
  active(
    query: ScheduleQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly ScheduleRecord[]>;
  /** The active schedules whose next run came by the query's time, the earliest first. */
  due(
    query: DueQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly ScheduleRecord[]>;
  /** Cancels an active schedule and answers it; `undefined` when it is unknown or not active. */
  cancel(
    cancel: ScheduleCancel,
    options: { readonly signal: AbortSignal },
  ): Promise<ScheduleRecord | undefined>;
  /**
   * Moves an active schedule's next run into its new zone while its next run is still the one
   * expected, and answers it; `undefined` when a run, a cancel or another move came first.
   */
  rezone(
    move: ScheduleRezone,
    options: { readonly signal: AbortSignal },
  ): Promise<ScheduleRecord | undefined>;
  /**
   * Records one run in `schedule_runs` and moves the schedule on, in one write. A run the engine
   * did not skip stores its wake-up in the agent's open session, opening `wake.opens` when none is
   * open, unless the schedule's last wake-up is still untaken (skipped `waiting`) or the agent holds
   * 200 untaken messages (skipped `busy`). The schedule takes the run's time and outcome, its next
   * run, or `ended` with none. A schedule no longer active, or no longer due at `dueAtMs`, is
   * `stale`, and nothing changes.
   */
  run(
    run: ScheduleRunDraft,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ScheduleRunWritten, "stale">>;
}
