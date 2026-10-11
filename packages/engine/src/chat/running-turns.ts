import type { Id } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import type { TurnMark } from "../operations/engine-call.js";

/** The turn an agent runs, as `turn/start` names it. */
export interface RunningTurn {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  /** Whether the turn's context held outside content when it started. */
  readonly hasOutsideContent: boolean;
}

/**
 * The agent runtime's running turns, held in the engine's memory (runtime spec, section 4.3): at
 * most one per agent, each with its outside-content mark, and the credential of the token the
 * engine made at the runtime's current start. Only a proposal made with that credential takes the
 * mark of its agent's running turn; every other proposal of a client with `agent` counts as
 * outside content.
 */
export interface RunningTurns {
  /** The runtime started with a new token: its turns of before are gone. */
  startRuntime(credential: Id<"tok">): void;
  /** The runtime exited: every running turn ends. */
  clearAll(): void;
  /** Records the agent's running turn, in place of any before it. */
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
}

/** Creates the engine's empty record of running turns, with no runtime started yet. */
export function createRunningTurns(): RunningTurns {
  const turns = new Map<string, RunningTurn>();
  const state: { runtime?: string } = {};
  const isRunning = (agent: string, turn: string): boolean => turns.get(agent)?.turn === turn;
  return {
    startRuntime(credential) {
      turns.clear();
      state.runtime = credential;
    },
    clearAll: () => turns.clear(),
    start(turn) {
      turns.set(turn.agent, { ...turn });
    },
    mark(agent, turn) {
      const running = turns.get(agent);
      if (running?.turn !== turn) {
        return false;
      }
      turns.set(agent, { ...running, hasOutsideContent: true });
      return true;
    },
    end: (agent, turn) => isRunning(agent, turn) && turns.delete(agent),
    markOf(credential, agent) {
      const running = turns.get(agent);
      if (state.runtime === undefined || credential !== state.runtime || running === undefined) {
        return undefined;
      }
      return { hasOutsideContent: running.hasOutsideContent };
    },
  };
}
