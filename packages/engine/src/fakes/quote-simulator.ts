import { err, type Id, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { Simulator } from "../ports.js";

/**
 * Creates a simulator for tests on a chain with no node to simulate on: the steps move exactly
 * what their quote says, the input spent and the expected output received, except for the
 * intents `refusing` names a failure for.
 */
export function createQuoteSimulator(
  refusing: (intent: Id<"int">) => SimulationFailure | undefined,
): Simulator {
  return {
    async simulate(intent, built, { signal }): Promise<Result<SimulationView, SimulationFailure>> {
      signal.throwIfAborted();
      const { amountIn, expectedOut, quotedAt } = built.quote;
      const refusal = refusing(intent);
      return await Promise.resolve(
        refusal === undefined
          ? ok({ spent: [amountIn], received: [expectedOut], simulatedAt: quotedAt })
          : err(refusal),
      );
    },
  };
}
