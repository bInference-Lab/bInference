import { err, type Id, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { Simulator } from "../ports.js";
import type { SimulatedSteps } from "../simulation/simulated-steps.js";

/**
 * Creates a simulator for tests that answers from a fixed table by intent, with no gas used, and
 * never touches a chain. An intent missing from the table has `simulation_reverted`.
 */
export function createFakeSimulator(
  simulations: ReadonlyMap<Id<"int">, Result<SimulationView, SimulationFailure>>,
): Simulator {
  return {
    async simulate(intent, _built, options): Promise<Result<SimulatedSteps, SimulationFailure>> {
      options.signal.throwIfAborted();
      const simulation = simulations.get(intent) ?? err("simulation_reverted");
      return await Promise.resolve(
        simulation.ok ? ok({ ...simulation.value, gasUsed: 0n }) : simulation,
      );
    },
  };
}
