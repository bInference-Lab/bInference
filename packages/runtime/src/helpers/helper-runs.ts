import type { Id } from "@binference/core";
import type { HelperRecord, HelperState } from "@binference/store";
import { written } from "../sessions/agent-stores.js";
import type { HelperRunView } from "./helper-run-log.js";
import {
  type HelperRunParts,
  type LiveRun,
  type RunEnd,
  runOnce,
  surfaceOf,
} from "./helper-run.js";
import { endedText } from "./helper-words.js";

/** A follow-up that waits for its helper's run to end, with the time limit of its own run. */
interface FollowUp {
  readonly message: string;
  readonly timeoutMs: number;
}

/** The runs of the agents' helpers in this runtime: each in its own line of work. */
export interface HelperRuns {
  /** The runtime stops: no run begins. */
  closing(): boolean;
  /** How many of the agent's helpers run now. */
  count(agent: Id<"agt">): number;
  /** Runs a helper that stands `running` with the message, then each follow-up that waits. */
  begin(helper: HelperRecord, message: string): void;
  /**
   * Keeps a follow-up for a helper that runs here, at most 4 waiting: `full` past them, `not_here`
   * for a helper that does not run here.
   */
  follow(helper: Id<"ses">, next: FollowUp): "queued" | "full" | "not_here";
  /** The log of the helper's current or last run here. */
  view(helper: Id<"ses">): HelperRunView | undefined;
  /** Stops a helper that runs here and waits for its end; false when it does not run here. */
  stop(helper: Id<"ses">): Promise<boolean>;
  /** Stops every helper of the agent. */
  stopAgent(agent: Id<"agt">): void;
  /** Halts every run as the runtime stops and waits for them; their rows stay `running`. */
  stopAll(): Promise<void>;
  /** Settles once no run is open, including runs that begin while it waits. */
  rested(): Promise<void>;
}

/** The runs' state, one map to a field. */
interface RunsState {
  readonly agents: Map<Id<"ses">, Id<"agt">>;
  readonly dones: Map<Id<"ses">, Promise<void>>;
  readonly lives: Map<Id<"ses">, LiveRun>;
  readonly stops: Map<Id<"ses">, "owner" | "runtime">;
  readonly follows: Map<Id<"ses">, FollowUp[]>;
  readonly views: Map<Id<"ses">, HelperRunView>;
  readonly closing: Set<"closing">;
}

// How many ended runs keep their log for `helper_read`.
const keptViews = 64;
// How many follow-ups wait for one helper's run to end.
const maxFollowUps = 4;

async function move(
  parts: HelperRunParts,
  helper: HelperRecord,
  to: { readonly state: HelperState; readonly outside?: boolean; readonly timeoutMs?: number },
): Promise<HelperRecord> {
  const change = {
    helper: helper.id,
    from: helper.state,
    to: to.state,
    atMs: parts.clock.now(),
    ...(to.outside === undefined ? {} : { outside: to.outside }),
    ...(to.timeoutMs === undefined ? {} : { timeoutMs: to.timeoutMs }),
    fence: parts.stores.fence,
  };
  return written(await parts.helpers.move(change, { signal: parts.lifetime }), "move a helper");
}

// The agent hears how its helper ended, with its report, marked when any run read outside content.
async function wake(parts: HelperRunParts, helper: HelperRecord, end: RunEnd): Promise<void> {
  const ended = {
    agent: helper.agentId,
    helper: helper.id,
    surface: await surfaceOf(parts, helper),
    text: endedText(helper, end),
    outsideContent: helper.outside,
  };
  await parts.client.call("helper/ended", ended, { signal: parts.lifetime }).catch(() => undefined);
}

// One run, a fault of which ends it failed, unless the runtime is stopping.
async function runSafely(
  parts: HelperRunParts,
  state: RunsState,
  run: { readonly helper: HelperRecord; readonly message: string },
): Promise<RunEnd> {
  const { helper, message } = run;
  const onStart = (live: LiveRun): void => {
    state.lives.set(helper.id, live);
    const stop = state.stops.get(helper.id);
    if (stop !== undefined) {
      live.stop(stop);
    }
  };
  try {
    return await runOnce(parts, helper, { message, onStart });
  } catch {
    return { state: "failed", failure: "failed", outside: false };
  } finally {
    const view = state.lives.get(helper.id)?.log.read();
    state.lives.delete(helper.id);
    if (view !== undefined) {
      state.views.delete(helper.id);
      state.views.set(helper.id, view);
      const oldest = [...state.views.keys()].slice(0, -keptViews);
      oldest.forEach((id) => state.views.delete(id));
    }
  }
}

// Runs the helper, ends its row, then runs the next follow-up, or tells the agent how it ended.
async function drive(
  parts: HelperRunParts,
  state: RunsState,
  run: { readonly helper: HelperRecord; readonly message: string },
): Promise<void> {
  const end = await runSafely(parts, state, run);
  const stop = state.stops.get(run.helper.id);
  if (stop === "runtime" || parts.lifetime.aborted) {
    return;
  }
  const to = stop === "owner" ? "stopped" : end.state;
  const ended = await move(parts, run.helper, { state: to, outside: end.outside });
  const next = to === "stopped" ? undefined : state.follows.get(ended.id)?.shift();
  if (next === undefined) {
    // A follow-up sent from now on finds the helper ended and starts its own run.
    state.follows.delete(ended.id);
    if (to !== "stopped") {
      await wake(parts, ended, end);
    }
    return;
  }
  const again = await move(parts, ended, { state: "running", timeoutMs: next.timeoutMs });
  await drive(parts, state, { helper: again, message: next.message });
}

// Keeps a follow-up for after the helper's run, at most {@link maxFollowUps} waiting.
function followUp(
  state: RunsState,
  ask: { readonly helper: Id<"ses">; readonly next: FollowUp },
): "queued" | "full" | "not_here" {
  const waiting = state.follows.get(ask.helper);
  if (waiting === undefined) {
    return "not_here";
  }
  if (waiting.length >= maxFollowUps) {
    return "full";
  }
  waiting.push(ask.next);
  return "queued";
}

function stopOne(state: RunsState, helper: Id<"ses">, reason: "owner" | "runtime"): void {
  state.stops.set(helper, reason);
  state.follows.delete(helper);
  state.lives.get(helper)?.stop(reason);
}

// Runs a helper in its own line of work, which keeps its place until the drive ends.
function beginRun(
  parts: HelperRunParts,
  state: RunsState,
  run: { readonly helper: HelperRecord; readonly message: string },
): void {
  const { helper } = run;
  state.agents.set(helper.id, helper.agentId);
  state.follows.set(helper.id, []);
  state.stops.delete(helper.id);
  const done = drive(parts, state, run)
    .catch(() => undefined)
    .finally(() => {
      // A follow-up may have begun a new run of the helper meanwhile, which keeps its place.
      if (state.dones.get(helper.id) === done) {
        [state.agents, state.dones, state.stops, state.follows].forEach((map) =>
          map.delete(helper.id),
        );
      }
    });
  state.dones.set(helper.id, done);
}

/** Creates the runs of one runtime start (decision 0403). */
export function createHelperRuns(parts: HelperRunParts): HelperRuns {
  const state: RunsState = {
    agents: new Map(),
    dones: new Map(),
    lives: new Map(),
    stops: new Map(),
    follows: new Map(),
    views: new Map(),
    closing: new Set(),
  };
  return {
    closing: () => state.closing.size > 0,
    count: (agent) => [...state.agents.values()].filter((each) => each === agent).length,
    begin: (helper, message) => beginRun(parts, state, { helper, message }),
    follow: (helper, next) => followUp(state, { helper, next }),
    view: (helper) => state.lives.get(helper)?.log.read() ?? state.views.get(helper),
    async stop(helper) {
      const done = state.dones.get(helper);
      if (done === undefined) {
        return false;
      }
      stopOne(state, helper, "owner");
      await done;
      return true;
    },
    stopAgent(agent) {
      const own = [...state.agents].filter(([, each]) => each === agent).map(([helper]) => helper);
      own.forEach((helper) => stopOne(state, helper, "owner"));
    },
    async stopAll() {
      state.closing.add("closing");
      [...state.dones.keys()].forEach((helper) => stopOne(state, helper, "runtime"));
      await Promise.allSettled(state.dones.values());
    },
    async rested() {
      while (state.dones.size > 0) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a follow-up may begin another run
        await Promise.allSettled(state.dones.values());
      }
    },
  };
}
