import { err, type Id, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { Simulator } from "../ports.js";

/**
 * Creates a simulator for tests that answers from a fixed table by intent and never touches a
 * chain. An intent missing from the table has `simulation_reverted`.
 */
export function createFakeSimulator(
  simulations: ReadonlyMap<Id<"int">, Result<SimulationView, SimulationFailure>>,
): Simulator {
  return {
    async simulate(intent, _built, options): Promise<Result<SimulationView, SimulationFailure>> {
      options.signal.throwIfAborted();
      return await Promise.resolve(simulations.get(intent) ?? err("simulation_reverted"));
    },
  };
}
