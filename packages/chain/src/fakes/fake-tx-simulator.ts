import type { TxSimulator } from "../simulation/ports.js";
import type { SimulatedStep } from "../simulation/simulated-step.js";

const reverted: SimulatedStep = { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };

/**
 * Creates a simulator for tests that never touches a chain: each draft does what the table holds
 * for its payload, so a test sets every transfer and approval a step makes, hidden ones too. A
 * draft missing from the table reverts and moves nothing.
 */
export function createFakeTxSimulator(steps: ReadonlyMap<string, SimulatedStep>): TxSimulator {
  return {
    async simulate(drafts, options): Promise<readonly SimulatedStep[]> {
      options.signal.throwIfAborted();
      return await Promise.resolve(drafts.map((draft) => steps.get(draft.payload) ?? reverted));
    },
  };
}
