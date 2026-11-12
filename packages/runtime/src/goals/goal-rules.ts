import { err, ok, replaceNul, type Result } from "@binference/core";
import type { GoalChange, GoalPauseReason } from "@binference/protocol";
import type { GoalRecord, GoalState, TurnOutcome } from "@binference/store";

/**
 * The limits of a goal (decision 0407): its goal turns, the goal turns in a row that may make no
 * progress, and the wait before the next goal turn after one that called no tool.
 */
export const goalLimits: {
  readonly maxGoalTurns: number;
  readonly maxStrikes: number;
  readonly idleWaitMs: number;
} = { maxGoalTurns: 50, maxStrikes: 3, idleWaitMs: 60_000 };

/** How a turn of a chat with a goal ended, as the goal's rules read it. */
export interface GoalTurnEnd {
  /** binference started the turn for the goal; an owner's message started any other. */
  readonly goalTurn: boolean;
  /** Its outcome, or `refused` when the engine did not start it. */
  readonly outcome: TurnOutcome | "refused";
  /** The engine refused it, or a call of it found, the day's model budget spent. */
  readonly budgetSpent: boolean;
  readonly toolCalls: number;
  /** A tool whose last call in the turn failed. */
  readonly failedTool?: string;
  /** What its model calls cost, in micro-dollars. */
  readonly spentMicros: bigint;
  readonly atMs: number;
}

/** What follows a turn: the goal's next state, the change to tell, and what the chat does next. */
export interface GoalStep {
  readonly next: GoalState;
  /** The change the owner hears of, when the goal's status moved. */
  readonly change?: GoalChange;
  /** What the chat does next: no goal turn, the next one now, or the next one after a wait. */
  readonly after: "stop" | "continue" | { readonly waitMs: number };
}

// A goal's state as a write keeps it, its pause reason and note dropped or kept as asked. A goal
// stored before decision 0416 may hold U+0000 in them, which the write would refuse.
function stateOf(goal: GoalRecord): GoalState {
  const { status, pauseReason, note, spentMicros, goalTurns, strikes, updatedAtMs } = goal;
  return {
    status,
    ...(pauseReason === undefined ? {} : { pauseReason: replaceNul(pauseReason) }),
    ...(note === undefined ? {} : { note: replaceNul(note) }),
    spentMicros,
    goalTurns,
    strikes,
    updatedAtMs,
  };
}

// A goal turn that called no tool, whose last call of a tool failed, or that ended failed or in a
// loop, made no progress the goal can count.
function madeNoProgress(ended: GoalTurnEnd): boolean {
  return (
    ended.toolCalls === 0 ||
    ended.failedTool !== undefined ||
    ended.outcome === "failed" ||
    ended.outcome === "loop"
  );
}

// The counts a turn adds: its spend, a goal turn, and a strike; an owner's turn clears the
// strikes. A turn the engine did not start counts nothing.
function counted(goal: GoalRecord, ended: GoalTurnEnd): GoalState {
  const state = { ...stateOf(goal), updatedAtMs: ended.atMs };
  if (ended.outcome === "refused") {
    return state;
  }
  return {
    ...state,
    spentMicros: goal.spentMicros + ended.spentMicros,
    goalTurns: goal.goalTurns + (ended.goalTurn ? 1 : 0),
    strikes: ended.goalTurn && madeNoProgress(ended) ? goal.strikes + 1 : 0,
  };
}

// The first limit the goal ran into, in the order the owner reads them.
function limitOf(
  goal: GoalRecord,
  next: GoalState,
  ended: GoalTurnEnd,
): GoalPauseReason | undefined {
  if (ended.budgetSpent || ended.outcome === "budget") {
    return "budget";
  }
  if (goal.budgetMicros !== undefined && next.spentMicros >= goal.budgetMicros) {
    return "goal_budget";
  }
  if (next.goalTurns >= goalLimits.maxGoalTurns) {
    return "turn_limit";
  }
  return next.strikes >= goalLimits.maxStrikes ? "no_progress" : undefined;
}

/** A goal's state as it pauses, for why. */
function pausedState(state: GoalState, reason: GoalPauseReason, atMs: number): GoalState {
  return { ...state, status: "paused", pauseReason: reason, updatedAtMs: atMs };
}

/**
 * What follows a turn of a chat whose goal is `goal` (decision 0407): the turn's spend counts on
 * the goal, a goal turn counts one more, and a goal turn that made no progress one more strike; an
 * owner's turn clears the strikes. An active goal pauses at the first limit it ran into: the day's
 * model budget, its own budget, its 50 goal turns, three goal turns in a row with no progress.
 * Otherwise the next goal turn follows: after a minute when this goal turn called no tool, at once
 * else. A turn the runtime stopped starts none, and a goal that is not active only counts.
 */
export function stepAfterTurn(goal: GoalRecord, ended: GoalTurnEnd): GoalStep {
  const next = counted(goal, ended);
  if (goal.status !== "active") {
    return { next, after: "stop" };
  }
  const limit = limitOf(goal, next, ended);
  if (limit !== undefined) {
    return { next: pausedState(next, limit, ended.atMs), change: "paused", after: "stop" };
  }
  if (ended.outcome === "stopped" || ended.outcome === "refused") {
    return { next, after: "stop" };
  }
  const isIdle = ended.goalTurn && ended.toolCalls === 0;
  return { next, after: isIdle ? { waitMs: goalLimits.idleWaitMs } : "continue" };
}

/** What the owner does to a goal; `complete` and `blocked` are the agent's. */
export type GoalMove =
  | { readonly to: "pause"; readonly reason: GoalPauseReason }
  | { readonly to: "resume" }
  | { readonly to: "complete" | "blocked"; readonly note?: string };

/** Why a move does not apply: the goal is complete, and only a clear ends it. */
export type GoalMoveRefusal = "done";

const changes = {
  pause: "paused",
  resume: "resumed",
  complete: "complete",
  blocked: "blocked",
} as const;

// A resume starts the goal's limits again: no strikes, and the limit it paused on counts anew.
function resumed(state: GoalState, reason: string | undefined): GoalState {
  const { pauseReason: _reason, ...rest } = state;
  return {
    ...rest,
    status: "active",
    strikes: 0,
    ...(reason === "goal_budget" ? { spentMicros: 0n } : {}),
    ...(reason === "turn_limit" ? { goalTurns: 0 } : {}),
  };
}

// The state a move leaves, from a goal that is not complete.
function movedState(goal: GoalRecord, move: GoalMove, atMs: number): GoalState {
  const state = { ...stateOf(goal), updatedAtMs: atMs };
  if (move.to === "pause") {
    return goal.status === "paused" ? state : pausedState(state, move.reason, atMs);
  }
  if (move.to === "resume") {
    return goal.status === "active" ? state : resumed(state, goal.pauseReason);
  }
  const { pauseReason: _reason, note: _note, ...rest } = state;
  return { ...rest, status: move.to, ...(move.note === undefined ? {} : { note: move.note }) };
}

/**
 * Moves a goal (decision 0407): a pause keeps an already paused goal as it is; a resume makes a
 * paused or blocked goal active again, its strikes cleared and the limit it paused on counted anew
 * (its spend after `goal_budget`, its goal turns after `turn_limit`); the agent's `complete` and
 * `blocked` take its note. A complete goal moves no more. Answers the change to tell, none when
 * nothing moved.
 */
export function moveGoal(
  goal: GoalRecord,
  move: GoalMove,
  atMs: number,
): Result<{ readonly next: GoalState; readonly change?: GoalChange }, GoalMoveRefusal> {
  if (goal.status === "complete") {
    return err("done");
  }
  const next = movedState(goal, move, atMs);
  const isSame = next.status === goal.status && next.note === goal.note;
  return ok(isSame ? { next } : { next, change: changes[move.to] });
}
