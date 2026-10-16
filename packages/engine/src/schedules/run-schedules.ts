import { BinferenceError, type Clock, type IdSource } from "@binference/core";
import type { ScheduleSkip } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { ModelBudget } from "../billing/model-budget.js";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import type { AgentStore } from "../ports.js";
import type { ScheduleStore } from "./ports.js";
import type { ScheduleRecord } from "./schedule-record.js";
import { followsOwnerZone, nextRunOf } from "./schedule-times.js";

/** What the schedule queue reads, writes and wakes the agent through. */
export interface ScheduleQueueOptions {
  readonly schedules: ScheduleStore;
  readonly agents: Pick<AgentStore, "get">;
  /** Each agent's daily model budget: a run starts no turn once it is spent. */
  readonly budget: Pick<ModelBudget, "open">;
  /** `owner.timezone` now, read at each run (decision 0118). */
  readonly ownerTimeZone: () => string;
  /** Pushes a wake-up a run stored on the `inbox` topic. */
  readonly woke: (message: AgentInboxMessage) => void;
  readonly ids: IdSource;
  readonly clock: Clock;
}

/** The engine's schedule queue: each call runs the schedules whose time came. */
export interface ScheduleQueue {
  run(options: { readonly signal: AbortSignal }): Promise<void>;
}

// The most runs one call makes; the rest wait for the next call.
const runsPerCall = 100;

// Whether a turn can start for the agent now, else why not: an agent that is gone or archived,
// frozen, or whose model budget of the day is spent. The budget tells the owner once that day.
async function skipOf(
  options: ScheduleQueueOptions,
  settings: AgentSettings | undefined,
  signal: AbortSignal,
): Promise<ScheduleSkip | undefined> {
  if (settings === undefined || settings.agent.archivedAtMs !== undefined) {
    return "archived";
  }
  if (settings.agent.frozenAtMs !== undefined) {
    return "frozen";
  }
  try {
    await options.budget.open(settings, { signal });
    return undefined;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "agent.budget") {
      return "budget";
    }
    throw error;
  }
}

async function runOne(
  options: ScheduleQueueOptions,
  schedule: ScheduleRecord,
  signal: AbortSignal,
): Promise<void> {
  const { ids, clock } = options;
  const { id, agentId, nextAtMs, prompt, outsideContent } = schedule;
  if (nextAtMs === undefined) {
    return;
  }
  const settings = await options.agents.get(agentId, { signal });
  const skip = await skipOf(options, settings, signal);
  const atMs = clock.now();
  // Runs missed while the engine was off or locked collapse into this one: the next run is the
  // first after now, never one already past (decision 0232).
  const next = nextRunOf(schedule.when, atMs, options.ownerTimeZone());
  const payload = { schedule: id, prompt, due: nextAtMs, outsideContent };
  const wake = { id: ids.next("msg"), turnId: ids.next("trn"), opens: ids.next("ses"), payload };
  const written = await options.schedules.run(
    {
      id,
      dueAtMs: nextAtMs,
      atMs,
      wake,
      ...(skip === undefined ? {} : { skip }),
      ...(next.ok && next.value !== undefined ? { next: next.value } : {}),
    },
    { signal },
  );
  if (written.ok && written.value.message !== undefined) {
    options.woke(written.value.message);
  }
}

// Moves each schedule that follows `owner.timezone` into the zone the owner set now, from now:
// a change of the zone never fires a run at once.
async function rezone(options: ScheduleQueueOptions, zone: string, signal: AbortSignal) {
  const active = await options.schedules.active({}, { signal });
  const moved = active.filter((each) => followsOwnerZone(each.when) && each.zone !== zone);
  const atMs = options.clock.now();
  for (const schedule of moved) {
    const next = nextRunOf(schedule.when, atMs, zone);
    if (next.ok && next.value !== undefined && schedule.nextAtMs !== undefined) {
      const move = { id: schedule.id, expectedNextAtMs: schedule.nextAtMs, atMs, ...next.value };
      // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
      await options.schedules.rezone(move, { signal });
    }
  }
}

/**
 * Creates the schedule queue (decisions 0231 and 0232). Each run runs every schedule whose time
 * came, the earliest first: one run each, however many runs it missed. It then moves the schedules
 * that follow `owner.timezone` into a zone the owner changed, from now. A run stores its
 * `inbox/scheduleDue` message and pushes it, unless the agent is gone, archived or frozen, or its
 * model budget of the day is spent; such a run is recorded as skipped with its reason. The store
 * also skips a run while the schedule's last wake-up still waits, or while the agent inbox is full.
 */
export function createScheduleQueue(options: ScheduleQueueOptions): ScheduleQueue {
  const seen: { zone?: string } = {};
  return {
    async run({ signal }) {
      const due = await options.schedules.due(
        { atMs: options.clock.now(), limit: runsPerCall },
        { signal },
      );
      for (const schedule of due) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
        await runOne(options, schedule, signal);
      }
      const zone = options.ownerTimeZone();
      if (seen.zone !== zone) {
        await rezone(options, zone, signal);
        seen.zone = zone;
      }
    },
  };
}
