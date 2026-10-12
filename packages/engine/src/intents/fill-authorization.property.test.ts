import type { Bps, Id, Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FillAuthorization } from "./authorization.js";
import type { AutoModeFacts } from "./auto-mode.js";
import { type FillBreach, fillBreaches } from "./intent-reason.js";
import type { IntentStatus } from "./intent-status.js";
import type { AuthorizationCheck } from "./intent-trigger.js";
import { createIntentStateMachine, type IntentStep } from "./state-machine.js";

const cards = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};
const machine = createIntentStateMachine({ clock: createManualClock(1_000) });

const fills: fc.Arbitrary<FillAuthorization> = fc.oneof(
  fc.constant({ order: "ord_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"ord"> }),
  fc.constant({
    webhookRule: "whr_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"whr">,
    alertId: "a",
  }),
);

const autoFacts: fc.Arbitrary<AutoModeFacts> = fc.record({
  approvalMode: fc.constantFrom("auto" as const, "manual" as const),
  modeVersion: fc.nat(5),
  isLocked: fc.boolean(),
  isInsideOwnPositions: fc.boolean(),
  sellsDeniedToken: fc.boolean(),
  valueUsdMicros: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  perTradeCapUsdMicros: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  rollingDayCapUsdMicros: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  rollingDaySpentUsdMicros: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  feePerGasNativeBase: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  networkFeeCapNativeBase: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  hasUnlistedSpender: fc.boolean(),
});

const checks: fc.Arbitrary<AuthorizationCheck> = fc.oneof(
  fc.constant({ by: "fill" as const }),
  fc.constantFrom(...fillBreaches).map((breach) => ({
    by: "fill" as const,
    breach,
  })),
  autoFacts.map((facts) => ({ by: "auto_mode" as const, facts })),
);

const statuses: fc.Arbitrary<IntentStatus> = fc.record({
  state: fc.constant("simulated" as const),
  kind: fc.constantFrom("buy" as const, "sell" as const, "swap" as const, "send" as const),
  proposer: fc.constant("engine" as const),
  isPaper: fc.boolean(),
  hasOutsideContent: fc.boolean(),
  changedAtMs: fc.constant(0),
  authorizedBy: fills,
});

// The state and reason a move left, or `undefined` when nothing moved.
function outcomeOf(moved: Result<IntentStep, string>): readonly unknown[] | undefined {
  return moved.ok ? [moved.value.status.state, moved.value.status.reason] : undefined;
}

// The authorization a move left, or `undefined` when nothing moved.
function authorizationOf(moved: Result<IntentStep, string>): unknown {
  return moved.ok ? moved.value.status.authorizedBy : undefined;
}

const breachOf = (check: AuthorizationCheck): FillBreach | undefined =>
  check.by === "fill" ? check.breach : undefined;

// What a fill's check allows at simulated: the confirmation on a clean fill check, failed_check
// with the breach it names, and nothing on any other check (spec 6, section 5; decision 0195).
function expectedOf(check: AuthorizationCheck): readonly unknown[] | undefined {
  if (check.by !== "fill") {
    return undefined;
  }
  const breach = breachOf(check);
  return breach === undefined ? ["confirmed", undefined] : ["failed_check", breach];
}

describe("a fill at simulated, for every fill, check and outside-content mark", () => {
  it("skips its card, confirms only on a clean fill check, and ends with the breach it names", () => {
    fc.assert(
      fc.property(statuses, checks, (status, check) => {
        const moved = machine.apply(status, { type: "authorization_checked", check, cards });
        expect(outcomeOf(moved)).toStrictEqual(expectedOf(check));
      }),
      { numRuns: 2_000 },
    );
  });

  it("keeps its order or rule as the authorization it was confirmed under", () => {
    fc.assert(
      fc.property(statuses, (status) => {
        const moved = machine.apply(status, {
          type: "authorization_checked",
          check: { by: "fill" },
          cards,
        });
        expect(authorizationOf(moved)).toStrictEqual(status.authorizedBy);
      }),
      { numRuns: 500 },
    );
  });
});
