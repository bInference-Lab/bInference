import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intentKinds } from "./intent-kind.js";
import type { IntentStatus } from "./intent-status.js";
import { createIntentStateMachine } from "./state-machine.js";

const machine = createIntentStateMachine({
  clock: { now: () => 0, sleep: async () => Promise.resolve() },
});

// An intent the money path has quoted, and one its risk check passed.
const beforeSimulation: fc.Arbitrary<IntentStatus> = fc.record({
  state: fc.constantFrom("quoted" as const, "assessed" as const),
  kind: fc.constantFrom(...intentKinds),
  proposer: fc.constantFrom("agent_runtime" as const, "mcp_client" as const, "owner" as const),
  isPaper: fc.boolean(),
  hasOutsideContent: fc.boolean(),
  changedAtMs: fc.nat(10_000_000),
});

const failures = fc.constantFrom("simulation_reverted" as const, "effects_differ" as const);

describe("a failed simulation of the chosen route", () => {
  it("ends a quoted or assessed intent failed_check with its reason, before any risk check", () => {
    fc.assert(
      fc.property(beforeSimulation, failures, (status, reason) => {
        const step = machine.apply(status, { type: "simulation_failed", reason });
        expect(step).toMatchObject({
          ok: true,
          value: { status: { state: "failed_check", reason } },
        });
      }),
    );
  });
});
