import type { LiveFactsView } from "@binference/protocol";
import { liveFactsText, type SettingsFacts } from "../context/live-facts-text.js";
import type { LiveFactsReader } from "./ports.js";

/**
 * The volatile tail of one turn's model calls (runtime spec, section 7.1): the live facts, read
 * before the turn's first call and again after a batch that wrote through the engine, and the
 * model budget left as the engine last answered (decision 0201).
 */
export interface TurnTail {
  /** The tail's text for the next model call, reading the facts again when they are old. */
  text(signal: AbortSignal): Promise<string>;
  /** What is left of the model budget, as `turn/start` or `usage/record` answered. */
  budget(leftMicros: bigint): void;
  /** A batch wrote through the engine: the next call reads the facts again. */
  stale(): void;
}

/** Reads the line of the chat's goal as it stands now, or none. */
export type GoalLineReader = (signal: AbortSignal) => Promise<string | undefined>;

/**
 * Creates a turn's {@link TurnTail} over its facts reader; nothing is read until the first call.
 * The goal's line is read again for every call, since the turn's own tools move the goal.
 */
export function createTurnTail(
  reader: LiveFactsReader,
  settings?: SettingsFacts,
  goalLine?: GoalLineReader,
): TurnTail {
  const state: { isStale: boolean; facts?: LiveFactsView; budgetLeftMicros?: bigint } = {
    isStale: true,
  };
  return {
    async text(signal) {
      if (state.isStale) {
        const facts = await reader.read(signal);
        state.isStale = false;
        if (facts === undefined) {
          delete state.facts;
        } else {
          state.facts = facts;
        }
      }
      const { facts, budgetLeftMicros } = state;
      const goal = await goalLine?.(signal);
      return liveFactsText({
        ...(facts === undefined ? {} : { facts }),
        ...(settings === undefined ? {} : { settings }),
        ...(goal === undefined ? {} : { goal }),
        ...(budgetLeftMicros === undefined ? {} : { budgetLeftMicros }),
      });
    },
    budget(leftMicros) {
      state.budgetLeftMicros = leftMicros;
    },
    stale() {
      state.isStale = true;
    },
  };
}
