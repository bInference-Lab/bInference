import type { Id } from "@binference/core";

/**
 * What is left of each agent's model budget, as the engine last answered it to any turn of the
 * agent or of its helpers (decision 0403). The engine answers it only at a turn's start and after
 * each model call, so a helper reads it here before its own first call.
 */
export interface BudgetMemory {
  /** What the engine last answered for the agent; `undefined` before it answered once. */
  leftOf(agent: Id<"agt">): bigint | undefined;
  /** The engine answered this for the agent; a spent budget is 0 or below. */
  note(agent: Id<"agt">, leftMicros: bigint): void;
}

/** Creates an empty {@link BudgetMemory} for one runtime start. */
export function createBudgetMemory(): BudgetMemory {
  const left = new Map<Id<"agt">, bigint>();
  return {
    leftOf: (agent) => left.get(agent),
    note(agent, leftMicros) {
      left.set(agent, leftMicros);
    },
  };
}
