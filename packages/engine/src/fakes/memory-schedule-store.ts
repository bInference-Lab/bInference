import { err, type Id, ok, type Result } from "@binference/core";
import type { AgentStore } from "../ports.js";
import type { ScheduleStore } from "../schedules/ports.js";
import { scheduleAfterRun } from "../schedules/schedule-after-run.js";
import {
  maxActiveSchedules,
  type ScheduleRecord,
  type ScheduleRunDraft,
  type ScheduleRunWritten,
} from "../schedules/schedule-record.js";
import type { MemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";

/** The agents an in-memory schedule store knows, and the inbox its runs store wake-ups in. */
export interface MemoryScheduleStoreOptions {
  readonly agents: Pick<AgentStore, "get">;
  readonly agentInbox: Pick<MemoryAgentInboxStore, "wakeNow">;
}

type Rows = Map<Id<"sch">, ScheduleRecord>;

function copyOf(schedule: ScheduleRecord | undefined): ScheduleRecord | undefined {
  return schedule === undefined ? undefined : structuredClone(schedule);
}

function activeOf(rows: Rows, agentId?: Id<"agt">): readonly ScheduleRecord[] {
  return [...rows.values()]
    .filter((stored) => stored.state === "active")
    .filter((stored) => agentId === undefined || stored.agentId === agentId)
    .toSorted(byCreation);
}

function create(rows: Rows, schedule: ScheduleRecord): Result<ScheduleRecord, "too_many"> {
  if (rows.has(schedule.id)) {
    throw constraintFault(`the schedule id ${schedule.id} is in use`);
  }
  if (activeOf(rows, schedule.agentId).length >= maxActiveSchedules) {
    return err("too_many");
  }
  rows.set(schedule.id, structuredClone(schedule));
  return ok(structuredClone(schedule));
}

function put(rows: Rows, schedule: ScheduleRecord): ScheduleRecord {
  rows.set(schedule.id, structuredClone(schedule));
  return structuredClone(schedule);
}

function runOnce(
  rows: Rows,
  inbox: MemoryScheduleStoreOptions["agentInbox"],
  run: ScheduleRunDraft,
): Result<ScheduleRunWritten, "stale"> {
  const schedule = rows.get(run.id);
  if (schedule?.state !== "active" || schedule.nextAtMs !== run.dueAtMs) {
    return err("stale");
  }
  const { lastMessageId, agentId } = schedule;
  const woke =
    run.skip === undefined
      ? inbox.wakeNow({
          agentId,
          wake: run.wake,
          atMs: run.atMs,
          ...(lastMessageId === undefined ? {} : { waitingFor: lastMessageId }),
        })
      : err(run.skip);
  const written = put(rows, scheduleAfterRun(schedule, run, woke.ok ? ok(woke.value.id) : woke));
  return ok(woke.ok ? { schedule: written, message: woke.value } : { schedule: written });
}

/** Creates an empty in-memory {@link ScheduleStore} for tests. */
export function createMemoryScheduleStore(options: MemoryScheduleStoreOptions): ScheduleStore {
  const rows: Rows = new Map();
  return {
    async create(schedule, call) {
      call.signal.throwIfAborted();
      const agent = await options.agents.get(schedule.agentId, call);
      return agent === undefined ? err("not_found") : create(rows, schedule);
    },
    get: async (id, call) => memoryCall(call, () => copyOf(rows.get(id))),
    active: async (query, call) =>
      memoryCall(call, () => structuredClone(activeOf(rows, query.agentId))),
    due: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          activeOf(rows)
            .filter((stored) => stored.nextAtMs !== undefined && stored.nextAtMs <= query.atMs)
            .toSorted((left, right) => (left.nextAtMs ?? 0) - (right.nextAtMs ?? 0))
            .slice(0, query.limit),
        ),
      ),
    cancel: async ({ id, atMs }, call) =>
      memoryCall(call, () => {
        const stored = rows.get(id);
        if (stored?.state !== "active") {
          return undefined;
        }
        const { nextAtMs: _next, ...rest } = stored;
        return put(rows, { ...rest, state: "cancelled", changedAtMs: atMs });
      }),
    rezone: async (move, call) =>
      memoryCall(call, () => {
        const stored = rows.get(move.id);
        if (stored?.state !== "active" || stored.nextAtMs !== move.expectedNextAtMs) {
          return undefined;
        }
        const { zone: _zone, ...rest } = stored;
        const zone = move.zone === undefined ? {} : { zone: move.zone };
        return put(rows, { ...rest, ...zone, nextAtMs: move.nextAtMs, changedAtMs: move.atMs });
      }),
    run: async (run, call) => memoryCall(call, () => runOnce(rows, options.agentInbox, run)),
  };
}
