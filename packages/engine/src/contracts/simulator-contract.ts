import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { Simulator } from "../ports.js";

/** An intent and the steps a quote built for it. */
export interface SimulatedSteps {
  readonly intent: Id<"int">;
  readonly built: BuiltQuote;
}

/** A simulator under test, steps whose effects match their intent, and steps whose do not. */
export interface SimulatorSubject {
  readonly simulator: Simulator;
  readonly matching: SimulatedSteps;
  readonly differing: SimulatedSteps;
}

/** Makes a fresh {@link SimulatorSubject} for each check. */
export interface SimulatorHarness {
  create(): SimulatorSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `Simulator` adapter passes. */
export function simulatorContract(harness: SimulatorHarness): readonly ContractCheck[] {
  return [
    {
      name: "reports the balance changes of steps that match their intent",
      run: async () => {
        const { simulator, matching } = harness.create();
        const simulation = await simulator.simulate(matching.intent, matching.built, live());
        assert.ok(simulation.ok);
        assert.ok(simulation.value.received.length > 0);
      },
    },
    {
      name: "refuses steps whose effects differ from their intent",
      run: async () => {
        const { simulator, differing } = harness.create();
        const simulation = await simulator.simulate(differing.intent, differing.built, live());
        assert.ok(!simulation.ok);
        assert.ok(["simulation_reverted", "effects_differ"].includes(simulation.error));
      },
    },
    {
      name: "refuses to simulate on an aborted signal",
      run: async () => {
        const { simulator, matching } = harness.create();
        const reason = new Error("stopped");
        const aborted = { signal: AbortSignal.abort(reason) };
        await assert.rejects(simulator.simulate(matching.intent, matching.built, aborted), reason);
      },
    },
  ];
}
