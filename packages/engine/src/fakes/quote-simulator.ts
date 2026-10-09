import { err, type Id, ok, type Result } from "@binference/core";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { Simulator } from "../ports.js";
import type { SimulatedSteps } from "../simulation/simulated-steps.js";

/** What a quote simulator measures of one venue's route. */
export interface RouteOutcome {
  /** The share of the quoted output that arrives, in basis points: a transfer tax lowers it. */
  readonly keptBps: bigint;
  readonly gasUsed: bigint;
}

const wholeRoute: RouteOutcome = { keptBps: 10_000n, gasUsed: 0n };

/**
 * Creates a simulator for tests on a chain with no node to simulate on: the steps spend the
 * quote's input and receive its expected output, less the tax of the route's outcome in `routes`,
 * with that outcome's gas; a venue `routes` does not name keeps the whole output and uses no gas.
 * The intents `refusing` names a failure for fail with it.
 */
export function createQuoteSimulator(
  refusing: (intent: Id<"int">) => SimulationFailure | undefined,
  routes: ReadonlyMap<string, RouteOutcome> = new Map(),
): Simulator {
  return {
    async simulate(intent, built, { signal }): Promise<Result<SimulatedSteps, SimulationFailure>> {
      signal.throwIfAborted();
      const { amountIn, expectedOut, quotedAt, route } = built.quote;
      const outcome = routes.get(route[0]?.venue ?? "") ?? wholeRoute;
      const received = { ...expectedOut, base: (expectedOut.base * outcome.keptBps) / 10_000n };
      const refusal = refusing(intent);
      const steps = { spent: [amountIn], received: [received], simulatedAt: quotedAt };
      return await Promise.resolve(
        refusal === undefined ? ok({ ...steps, gasUsed: outcome.gasUsed }) : err(refusal),
      );
    },
  };
}
