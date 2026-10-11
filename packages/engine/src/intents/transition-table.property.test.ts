import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CardRules } from "./card-rules.js";
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

const cards: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as never,
};

// A tapped intent the queue holds while the fee per gas is above the cap.
const tappedConfirmed = fc.record({
  state: fc.constant("confirmed" as const),
  kind: fc.constantFrom(...intentKinds),
  proposer: fc.constant("owner" as const),
  isPaper: fc.boolean(),
  hasOutsideContent: fc.boolean(),
  changedAtMs: fc.nat(10_000_000),
  card: fc.record({
    version: fc.integer({ min: 1, max: 5 }),
    openedAtMs: fc.nat(10_000_000),
    expiresAtMs: fc.nat(10_000_000),
  }),
});

const nowMs = 1_000_000;
const lapsing = createIntentStateMachine({
  clock: { now: () => nowMs, sleep: async () => Promise.resolve() },
});

describe("a fee wait that outlasts the owner's confirmation", () => {
  it("opens the next card version once the confirmation ran out", () => {
    fc.assert(
      fc.property(tappedConfirmed, fc.nat(nowMs), (status, expiresAtMs) => {
        const step = lapsing.apply(status, { type: "fee_wait_lapsed", expiresAtMs, cards });
        const card = { version: status.card.version + 1, openedAtMs: nowMs };
        expect(step).toMatchObject({
          ok: true,
          value: { status: { state: "awaiting_confirmation", card } },
        });
      }),
    );
  });

  it("opens no card while the confirmation lasts", () => {
    fc.assert(
      fc.property(tappedConfirmed, fc.nat(nowMs), (status, ahead) => {
        const expiresAtMs = nowMs + ahead + 1;
        const step = lapsing.apply(status, { type: "fee_wait_lapsed", expiresAtMs, cards });
        expect(step.ok).toBe(false);
      }),
    );
  });

  it("opens no card for an intent the auto mode authorized", () => {
    const authorizedBy = { approvalMode: "auto" as const, modeVersion: 1 };
    fc.assert(
      fc.property(tappedConfirmed, (status) => {
        const trigger = { type: "fee_wait_lapsed", expiresAtMs: 0, cards } as const;
        expect(lapsing.apply({ ...status, authorizedBy }, trigger).ok).toBe(false);
      }),
    );
  });
});
