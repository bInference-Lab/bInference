import { BinferenceError, type Clock, type Id, type Logger } from "@binference/core";
import { maxTurnMs, type ProtocolId } from "@binference/protocol";
import type { TurnMark } from "../operations/engine-call.js";

/** The turn an agent runs, as `turn/start` names it. */
export interface RunningTurn {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  /** Whether the turn's context held outside content when it started. */
  readonly hasOutsideContent: boolean;
  /** The inbox messages the turn took when it started, which a launch draft's photo comes from. */
  readonly messages?: readonly ProtocolId<"inboxMessage">[];
}

/**
 * Why the engine ended a running turn whose `turn/end` never came (decision 0442): the runtime
 * exited or started again, the agent's next turn started, or the turn ran a minute past its limit.
 */
export type TurnLapseCause = "runtime_exit" | "next_turn" | "deadline";

/** A running turn the engine ended without the runtime's `turn/end`, and why. */
export interface TurnLapse {
  readonly turn: RunningTurn;
  readonly cause: TurnLapseCause;
}

/**
 * How long the engine holds a running turn: the turn's own limit, which the runtime reads too, and
 * a minute for its stop's grace and its end writes (decision 0442).
 */
export const turnLapseMs: number = maxTurnMs + 60_000;

/**
 * The agent runtime's running turns, held in the engine's memory (runtime spec, section 4.3): at
 * most one per agent, each with its outside-content mark, and the credential of the token the
 * engine made at the runtime's current start. Only a proposal made with that credential takes the
 * mark of its agent's running turn; every other proposal of a client with `agent` counts as
 * outside content. A turn whose `turn/end` never came lapses (decision 0442): each listener hears
 * it once, so no surface shows it running for good.
 */
export interface RunningTurns {
  /** The runtime started with a new token: each turn of before lapses, `runtime_exit`. */
  startRuntime(credential: Id<"tok">): void;
  /** The runtime exited: each running turn lapses, `runtime_exit`. */
  clearAll(): void;
  /**
   * Whether a call comes from the runtime the engine runs now: made with the token of its current
   * start. A token of an earlier start, or of any other client, is not.
   */
  isRuntime(credential: string): boolean;
  /** The agent's running turn, if one runs. */
  runningOf(agent: ProtocolId<"agent">): RunningTurn | undefined;
  /**
   * Records the agent's running turn. Another turn of the agent it replaces lapses first,
   * `next_turn`; the new turn lapses `deadline` once `turnLapseMs` passed unended.
   */
  start(turn: RunningTurn): void;
  /** Marks the turn as holding outside content; the mark never clears. False when it is not running. */
  mark(agent: ProtocolId<"agent">, turn: ProtocolId<"chatTurn">): boolean;
  /** Ends the turn; false when it is not running. */
  end(agent: ProtocolId<"agent">, turn: ProtocolId<"chatTurn">): boolean;
  /**
   * The mark a proposal for `agent` made with `credential` takes: its agent's running turn's, when
   * the credential is the runtime's current one and a turn runs; otherwise none.
   */
  markOf(credential: string, agent: ProtocolId<"agent">): TurnMark | undefined;
  /** Hears each turn that lapses, as it lapses; answers the call that stops hearing. */
  onLapse(listener: (lapse: TurnLapse) => void): () => void;
  /**
   * Whether the turn, which no longer runs, is the last one of its agent that lapsed since the
   * engine started: the owner read its `turn.failed.lapsed` already. The record keeps one turn
   * per agent, for the `lapsedAgentsKept` agents whose turns lapsed last; an older one is
   * forgotten, and its turn reads as never lapsed.
   */
  hasLapsed(agent: ProtocolId<"agent">, turn: ProtocolId<"chatTurn">): boolean;
}

/**
 * How many agents the running turns remember a lapsed turn for: far more than an install runs,
 * so only an engine of that many agents forgets one, and then the oldest (decision 0442).
 */
export const lapsedAgentsKept: number = 1_000;

/** What the running turns read the time on, for each turn's deadline. */
export interface RunningTurnsOptions {
  readonly clock: Clock;
  /**
   * Where a listener that throws is logged. Only an engine with no runtime leaves it out: it starts
   * no turn, so nothing lapses.
   */
  readonly logger?: Logger;
}

interface Held {
  readonly turns: Map<string, RunningTurn>;
  /** Each running turn's deadline, by its agent: aborting one stops its timer. */
  readonly deadlines: Map<string, AbortController>;
  readonly listeners: Set<(lapse: TurnLapse) => void>;
  /** The last turn that lapsed of each agent, oldest agent first. */
  readonly lapsed: Map<string, string>;
  readonly clock: Clock;
  readonly logger?: Logger;
}

function stopDeadline(held: Held, agent: string): void {
  held.deadlines.get(agent)?.abort();
  held.deadlines.delete(agent);
}

// Each listener hears the lapse on its own: one that throws is logged, and never stops the others,
// the `turn/start` that replaced the turn or the runtime's exit.
function tell(held: Held, told: TurnLapse): void {
  for (const listener of held.listeners) {
    try {
      listener(told);
    } catch (error) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      const { agent, turn } = told.turn;
      held.logger?.error("chat.lapse_unheard", { agentId: agent, traceId: turn, errorCode });
    }
  }
}

// The agent's last lapsed turn goes to the newest end of the record; past its size, the agent whose
// turn lapsed longest ago leaves it.
function remember(held: Held, turn: RunningTurn): void {
  held.lapsed.delete(turn.agent);
  held.lapsed.set(turn.agent, turn.turn);
  const [oldest] = held.lapsed.keys();
  if (held.lapsed.size > lapsedAgentsKept && oldest !== undefined) {
    held.lapsed.delete(oldest);
  }
}

// Forgets the turn, stops its deadline, remembers it lapsed and tells every listener once.
function lapse(held: Held, turn: RunningTurn, cause: TurnLapseCause): void {
  held.turns.delete(turn.agent);
  stopDeadline(held, turn.agent);
  remember(held, turn);
  tell(held, { turn, cause });
}

function lapseAll(held: Held): void {
  [...held.turns.values()].forEach((turn) => lapse(held, turn, "runtime_exit"));
}

// Ends the turn `deadline` once its wait on the clock is over, unless it ended before; its end, a
// replacement and the runtime's exit abort the wait.
async function lapseAfter(wait: Promise<void>, held: Held, turn: RunningTurn): Promise<void> {
  await wait;
  if (held.turns.get(turn.agent)?.turn === turn.turn) {
    lapse(held, turn, "deadline");
  }
}

function watchDeadline(held: Held, turn: RunningTurn): void {
  const stop = new AbortController();
  held.deadlines.set(turn.agent, stop);
  void lapseAfter(held.clock.sleep(turnLapseMs, stop.signal), held, turn).catch(() => undefined);
}

function startTurn(held: Held, turn: RunningTurn): void {
  const before = held.turns.get(turn.agent);
  if (before !== undefined && before.turn !== turn.turn) {
    lapse(held, before, "next_turn");
  }
  stopDeadline(held, turn.agent);
  held.turns.set(turn.agent, { ...turn });
  watchDeadline(held, turn);
}

// The runtime's own end of its turn: the turn is forgotten and its deadline stops, with no lapse.
function endTurn(held: Held, agent: string, turn: string): boolean {
  if (held.turns.get(agent)?.turn !== turn) {
    return false;
  }
  held.turns.delete(agent);
  stopDeadline(held, agent);
  return true;
}

/**
 * Creates the engine's empty record of running turns, with no runtime started yet. Each turn
 * lapses `deadline` once `turnLapseMs` passed on the clock without its `turn/end`.
 */
export function createRunningTurns(options: RunningTurnsOptions): RunningTurns {
  const held: Held = {
    turns: new Map(),
    deadlines: new Map(),
    listeners: new Set(),
    lapsed: new Map(),
    clock: options.clock,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };
  const state: { runtime?: string } = {};
  return {
    startRuntime(credential) {
      lapseAll(held);
      state.runtime = credential;
    },
    clearAll: () => lapseAll(held),
    isRuntime: (credential) => state.runtime !== undefined && credential === state.runtime,
    runningOf: (agent) => {
      const running = held.turns.get(agent);
      return running === undefined ? undefined : { ...running };
    },
    start: (turn) => startTurn(held, turn),
    mark(agent, turn) {
      const running = held.turns.get(agent);
      if (running?.turn !== turn) {
        return false;
      }
      held.turns.set(agent, { ...running, hasOutsideContent: true });
      return true;
    },
    end: (agent, turn) => endTurn(held, agent, turn),
    markOf(credential, agent) {
      const running = held.turns.get(agent);
      if (state.runtime === undefined || credential !== state.runtime || running === undefined) {
        return undefined;
      }
      return { hasOutsideContent: running.hasOutsideContent };
    },
    onLapse(listener) {
      held.listeners.add(listener);
      return () => held.listeners.delete(listener);
    },
    hasLapsed: (agent, turn) =>
      held.lapsed.get(agent) === turn && held.turns.get(agent)?.turn !== turn,
  };
}
