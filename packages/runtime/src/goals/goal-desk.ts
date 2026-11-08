import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { ChatSurface, GoalChange, GoalPauseReason } from "@binference/protocol";
import type {
  GoalRecord,
  GoalState,
  GoalStore,
  PlanStep,
  ProgressNoteRecord,
} from "@binference/store";
import { written } from "../sessions/agent-stores.js";
import type { ToolClient } from "../tools/tool-client.js";
import { type GoalMove, moveGoal } from "./goal-rules.js";
import { goalViewOf, noteViewOf } from "./goal-views.js";
import { goalTurnText } from "./goal-words.js";

/** A chat: its agent and session. */
interface GoalChat {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
}

/** A chat's goal and progress note, as they stand. */
export interface GoalReading {
  readonly goal?: GoalRecord;
  readonly note?: ProgressNoteRecord;
}

/** A goal to set: its objective and the most its turns may spend. */
interface GoalRequest extends GoalChat {
  readonly objective: string;
  readonly budgetMicros?: bigint;
}

/** A progress note to put in place of the chat's one. */
interface NoteRequest extends GoalChat {
  readonly markdown: string;
  readonly plan: readonly PlanStep[];
}

/**
 * Why the desk did not do what was asked: the chat has a goal already, has none, its session is
 * not held, or its goal is complete.
 */
export type GoalRefusal = "exists" | "none" | "no_session" | "done";

/**
 * Each chat's goal and progress note (decision 0407): the one place that writes them, and tells
 * every surface of each change with `goal/show`.
 */
export interface GoalDesk {
  read(session: Id<"ses">, signal: AbortSignal): Promise<GoalReading>;
  /** The active goals of every chat, which a start picks up. */
  active(signal: AbortSignal): Promise<readonly GoalRecord[]>;
  /** Sets the chat's goal, `active`; a chat that has one keeps it (`exists`). */
  set(request: GoalRequest, signal: AbortSignal): Promise<Result<GoalRecord, GoalRefusal>>;
  /** Moves the chat's goal, and tells of the change. */
  move(
    chat: GoalChat,
    move: GoalMove,
    signal: AbortSignal,
  ): Promise<Result<GoalRecord, GoalRefusal>>;
  /** Writes the state a turn left, from the goal read before it, and tells of a change. */
  write(goal: GoalRecord, step: Step, signal: AbortSignal): Promise<GoalRecord | undefined>;
  /** Pauses the chat's goal for why, when it is active or blocked. */
  pause(chat: GoalChat, reason: GoalPauseReason, signal: AbortSignal): Promise<void>;
  /** Removes the chat's goal, and tells of it; answers whether it had one. */
  clear(chat: GoalChat, signal: AbortSignal): Promise<boolean>;
  /** Removes the goal and the progress note of a chat the owner cleared, and tells of it. */
  forget(chat: GoalChat, signal: AbortSignal): Promise<void>;
  /**
   * Asks the engine for the goal's next turn with `goal/continue`, on the surface named, marked
   * when the turn before it was; a call the engine does not answer starts none. Answers `frozen`
   * when the engine refused it for a frozen agent.
   */
  request(
    goal: GoalRecord,
    at: { readonly surface: ChatSurface; readonly outside: boolean },
    signal: AbortSignal,
  ): Promise<"asked" | "frozen">;
  /** Puts the chat's progress note in place of its one, and tells of it. */
  putNote(
    request: NoteRequest,
    signal: AbortSignal,
  ): Promise<Result<ProgressNoteRecord | undefined, "no_session">>;
}

/** What the desk writes and tells through. */
export interface GoalDeskOptions {
  readonly goals: GoalStore;
  readonly fence: number;
  /** Where each change goes: `goal/show`. */
  readonly client: ToolClient;
  readonly clock: Clock;
}

// Tells every surface of a change, best effort: a surface reads the goal again with `goal/get`.
async function show(
  options: GoalDeskOptions,
  at: GoalChat & { readonly change: GoalChange },
  signal: AbortSignal,
): Promise<void> {
  const [goal, note] = await Promise.all([
    options.goals.get(at.session, { signal }),
    options.goals.note(at.session, { signal }),
  ]);
  const shown = {
    agent: at.agent,
    session: at.session,
    change: at.change,
    ...(goal === undefined ? {} : { goal: goalViewOf(goal) }),
    ...(note === undefined ? {} : { note: noteViewOf(note) }),
  };
  await options.client.call("goal/show", shown, { signal }).catch(() => undefined);
}

/** A turn's step for a goal: the state it leaves and the change to tell. */
interface Step {
  readonly next: GoalState;
  readonly change?: GoalChange;
}

async function writeStep(
  options: GoalDeskOptions,
  at: { readonly goal: GoalRecord; readonly step: Step },
  signal: AbortSignal,
): Promise<GoalRecord | undefined> {
  const { goal, step } = at;
  const write = { sessionId: goal.sessionId, version: goal.version, next: step.next };
  const stored = await options.goals.write({ ...write, fence: options.fence }, { signal });
  if (!stored.ok && stored.error === "fenced") {
    written(stored, "write a goal");
  }
  if (!stored.ok) {
    return undefined;
  }
  if (step.change !== undefined) {
    const shown = { agent: goal.agentId, session: goal.sessionId, change: step.change };
    await show(options, shown, signal);
  }
  return stored.value;
}

// A move from the goal as it stands now; `stale` when another write raised it meanwhile.
async function moveOnce(
  options: GoalDeskOptions,
  at: { readonly chat: GoalChat; readonly move: GoalMove },
  signal: AbortSignal,
): Promise<Result<GoalRecord, GoalRefusal> | "stale"> {
  const goal = await options.goals.get(at.chat.session, { signal });
  if (goal === undefined) {
    return err("none");
  }
  const moved = moveGoal(goal, at.move, options.clock.now());
  if (!moved.ok) {
    return err(moved.error);
  }
  const stored = await writeStep(options, { goal, step: moved.value }, signal);
  return stored === undefined ? "stale" : ok(stored);
}

// A move, read again once when another write raised the goal meanwhile.
function moveOf(options: GoalDeskOptions): GoalDesk["move"] {
  return async (chat, move, signal) => {
    const first = await moveOnce(options, { chat, move }, signal);
    const again = first === "stale" ? await moveOnce(options, { chat, move }, signal) : first;
    return again === "stale" ? err("none") : again;
  };
}

function setOf(options: GoalDeskOptions): GoalDesk["set"] {
  const { goals, fence, clock } = options;
  return async (request, signal) => {
    const { agent, session, objective, budgetMicros } = request;
    const draft = { sessionId: session, agentId: agent, objective, startedAtMs: clock.now() };
    const budget = budgetMicros === undefined ? {} : { budgetMicros };
    const set = await goals.set({ ...draft, ...budget, fence }, { signal });
    if (!set.ok) {
      return set.error === "fenced" ? written(set, "set a goal") : err(set.error);
    }
    await show(options, { agent, session, change: "set" }, signal);
    return set;
  };
}

function clearOf(options: GoalDeskOptions): GoalDesk["clear"] {
  return async (chat, signal) => {
    const clear = { sessionId: chat.session, fence: options.fence };
    const cleared = written(await options.goals.clear(clear, { signal }), "clear a goal");
    if (cleared) {
      await show(options, { ...chat, change: "cleared" }, signal);
    }
    return cleared;
  };
}

// A cleared chat keeps no goal and no note; every surface hears it once.
function forgetOf(options: GoalDeskOptions): GoalDesk["forget"] {
  const { goals, fence, clock } = options;
  return async (chat, signal) => {
    written(await goals.clear({ sessionId: chat.session, fence }, { signal }), "clear a goal");
    const empty = { sessionId: chat.session, agentId: chat.agent, markdown: "", plan: [] };
    const note = { ...empty, updatedAtMs: clock.now(), fence };
    const put = await goals.putNote(note, { signal });
    if (!put.ok && put.error === "fenced") {
      written(put, "clear a progress note");
    }
    await show(options, { ...chat, change: "cleared" }, signal);
  };
}

function putNoteOf(options: GoalDeskOptions): GoalDesk["putNote"] {
  const { goals, fence, clock } = options;
  return async (request, signal) => {
    const { agent, session, markdown, plan } = request;
    const note = { sessionId: session, agentId: agent, markdown, plan, updatedAtMs: clock.now() };
    const put = await goals.putNote({ ...note, fence }, { signal });
    if (!put.ok) {
      return put.error === "fenced" ? written(put, "put a progress note") : err(put.error);
    }
    await show(options, { agent, session, change: "note" }, signal);
    return put;
  };
}

/** Creates the {@link GoalDesk} over the goal store of one runtime start. */
export function createGoalDesk(options: GoalDeskOptions): GoalDesk {
  const { goals } = options;
  const move = moveOf(options);
  return {
    async read(session, signal) {
      const [goal, note] = await Promise.all([
        goals.get(session, { signal }),
        goals.note(session, { signal }),
      ]);
      return { ...(goal === undefined ? {} : { goal }), ...(note === undefined ? {} : { note }) };
    },
    active: async (signal) => goals.active({ signal }),
    set: setOf(options),
    move,
    write: async (goal, step, signal) => writeStep(options, { goal, step }, signal),
    async pause(chat, reason, signal) {
      const goal = await goals.get(chat.session, { signal });
      if (goal?.status === "active" || goal?.status === "blocked") {
        await move(chat, { to: "pause", reason }, signal);
      }
    },
    clear: clearOf(options),
    forget: forgetOf(options),
    async request(goal, at, signal) {
      const args = {
        agent: goal.agentId,
        session: goal.sessionId,
        surface: at.surface,
        text: goalTurnText(goal),
        outsideContent: at.outside,
      };
      try {
        await options.client.call("goal/continue", args, { signal });
        return "asked";
      } catch (error) {
        const isFrozen = error instanceof Error && "code" in error && error.code === "agent.frozen";
        return isFrozen ? "frozen" : "asked";
      }
    },
    putNote: putNoteOf(options),
  };
}
