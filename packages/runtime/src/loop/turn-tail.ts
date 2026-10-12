import type { LiveFactsView } from "@binference/protocol";
import { liveFactsText } from "../context/live-facts-text.js";
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

/** Creates a turn's {@link TurnTail} over its facts reader; nothing is read until the first call. */
export function createTurnTail(reader: LiveFactsReader): TurnTail {
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
      return liveFactsText({
        ...(facts === undefined ? {} : { facts }),
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
