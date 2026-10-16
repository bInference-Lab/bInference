import { type Clock, err, type IdSource, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf, ScheduleView } from "@binference/protocol";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { activeAgent } from "../operations/active-agent.js";
import {
  answererOf,
  type EngineCall,
  type EngineHandler,
  proposerOf,
} from "../operations/engine-call.js";
import type { AgentStore, ConfigJournal } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { ScheduleStore } from "./ports.js";
import {
  scheduleCancelledNotice,
  type ScheduleMover,
  scheduleSetNotice,
} from "./schedule-notices.js";
import { maxSchedulePrompt, type ScheduleRecord } from "./schedule-record.js";
import { nextRunOf } from "./schedule-times.js";
import { scheduleJson, scheduleViewOf } from "./schedule-view-of.js";

/** The handlers of the schedule operations (protocol spec, section 7.5). */
export interface ScheduleHandlers {
  readonly "schedule/create": EngineHandler<"schedule/create">;
  readonly "schedule/list": EngineHandler<"schedule/list">;
  readonly "schedule/cancel": EngineHandler<"schedule/cancel">;
}

/** What the schedule handlers read, write, journal and announce through. */
export interface ScheduleHandlersOptions {
  readonly schedules: ScheduleStore;
  readonly agents: AgentStore;
  readonly journal: ConfigJournal;
  /** `owner.timezone` now, for a schedule that names no zone of its own. */
  readonly ownerTimeZone: () => string;
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type ScheduleCall = EngineCall<"schedule/create"> | EngineCall<"schedule/cancel">;

// The agent runtime is named as the agent; the owner by the surface the call came from.
function moverOf(call: ScheduleCall, proposer: Proposer, agentName: string): ScheduleMover {
  const by = proposer.role === "agent_runtime" ? "agent" : answererOf(call.caller).surface;
  return { agentName, by };
}

// Every change is journaled with who made it and where, and announced on every surface.
async function announce(
  options: ScheduleHandlersOptions,
  change: {
    readonly call: ScheduleCall;
    readonly path: string;
    readonly before?: ScheduleRecord;
    readonly after: ScheduleRecord;
    readonly notice: ReturnType<typeof scheduleSetNotice>;
  },
): Promise<void> {
  const { call, path, before, after, notice } = change;
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: after.changedAtMs,
      path,
      ...(before === undefined ? {} : { before: scheduleJson(before) }),
      after: scheduleJson(after),
      notices: [notice],
    },
    { signal: call.signal },
  );
}

// A schedule set by an outside client, or in a turn that read outside content, starts its turns
// marked (decision 0233).
function isOutside(proposer: Proposer): boolean {
  return proposer.hasOutsideContent || proposer.role === "mcp_client";
}

async function create(
  options: ScheduleHandlersOptions,
  call: EngineCall<"schedule/create">,
): Promise<Result<ScheduleView, ProtocolErrorCode>> {
  const proposer = proposerOf(call.caller);
  if (proposer === undefined) {
    return err("auth.scope");
  }
  const { agent, when, prompt } = call.args;
  const settings = await activeAgent(options.agents, agent, call);
  if (!settings.ok) {
    return settings;
  }
  if (prompt.length > maxSchedulePrompt) {
    return err("protocol.bad_args");
  }
  const nowMs = options.clock.now();
  const next = nextRunOf(when, nowMs, options.ownerTimeZone());
  if (!next.ok || next.value === undefined) {
    return err("schedule.bad_when");
  }
  const record: ScheduleRecord = {
    id: options.ids.next("sch"),
    agentId: agent,
    when,
    prompt,
    state: "active",
    ...next.value,
    createdBy: proposer.ref,
    outsideContent: isOutside(proposer),
    createdAtMs: nowMs,
    changedAtMs: nowMs,
  };
  const stored = await options.schedules.create(record, call);
  if (!stored.ok) {
    return err(stored.error === "too_many" ? "schedule.too_many" : "agent.not_found");
  }
  const { name } = settings.value.agent;
  const notice = scheduleSetNotice(stored.value, moverOf(call, proposer, name));
  await announce(options, { call, path: `agents.${name}.schedules`, after: stored.value, notice });
  return ok(scheduleViewOf(stored.value));
}

async function cancel(
  options: ScheduleHandlersOptions,
  call: EngineCall<"schedule/cancel">,
): Promise<Result<ResultOf<"schedule/cancel">, ProtocolErrorCode>> {
  const proposer = proposerOf(call.caller);
  if (proposer === undefined) {
    return err("auth.scope");
  }
  const stored = await options.schedules.get(call.args.schedule, call);
  if (stored?.state !== "active") {
    return err("schedule.not_found");
  }
  // A client with `propose` alone cancels only the schedules it set, as with auto orders.
  if (proposer.role === "mcp_client" && stored.createdBy !== proposer.ref) {
    return err("auth.scope");
  }
  const atMs = options.clock.now();
  const cancelled = await options.schedules.cancel({ id: stored.id, atMs }, call);
  if (cancelled === undefined) {
    return err("schedule.not_found");
  }
  const settings = await options.agents.get(stored.agentId, call);
  const name = settings?.agent.name ?? stored.agentId;
  const notice = scheduleCancelledNotice(cancelled, moverOf(call, proposer, name));
  const path = `agents.${name}.schedules`;
  await announce(options, { call, path, before: stored, after: cancelled, notice });
  return ok({});
}

/**
 * Creates the schedule handlers (decisions 0231 to 0233): `schedule/create` stores an active
 * schedule with its first run, marked when an outside client or a marked turn set it, then
 * journals and announces it; `schedule/list` answers the active schedules of one agent or all,
 * oldest first; `schedule/cancel` ends an active one at once, journaled and announced. None moves
 * money, so none opens a card.
 */
export function createScheduleHandlers(options: ScheduleHandlersOptions): ScheduleHandlers {
  return {
    "schedule/create": async (call) => create(options, call),
    async "schedule/list"(call) {
      const query = call.args.agent === undefined ? {} : { agentId: call.args.agent };
      const active = await options.schedules.active(query, call);
      return ok({ items: active.map((schedule) => scheduleViewOf(schedule)) });
    },
    "schedule/cancel": async (call) => cancel(options, call),
  };
}
