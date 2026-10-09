import type { SimulationView } from "@binference/protocol";

/** What a simulation of a quote's steps measured: the wallet's balance changes, and the gas. */
export interface SimulatedSteps extends SimulationView {
  /**
   * The gas the steps used together, in the chain family's own unit. Its fee is never among the
   * balance changes, so the best quote counts it apart.
   */
  readonly gasUsed: bigint;
}

/** The view an intent stores and shows of a simulation: its balance changes and its time. */
export function simulationViewOf(steps: SimulatedSteps): SimulationView {
  return { spent: steps.spent, received: steps.received, simulatedAt: steps.simulatedAt };
}
