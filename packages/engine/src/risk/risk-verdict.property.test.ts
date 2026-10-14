import type { RiskFlagCode } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { riskVerdict, type RiskFindings, type SourceAnswer } from "./risk-verdict.js";

const bps = (value: number) => bpsSchema.parse(value);
const taxes = fc.integer({ min: 0, max: 10_000 });

// The one required source's report, deep and with the given flags.
function answerOf(flags: readonly RiskFlagCode[]): SourceAnswer {
  const report = { flags, liquidityUsdMicros: 50_000_000_000n };
  return { id: "required", isRequired: true, outcome: "reported", report };
}

// A buy whose quote names `snipe` as its launch-window tax, which the round trip also measured on
// the buy leg, as it does on a launchpad's curve.
function findingsOf(snipe: number, max: number, flags: readonly RiskFlagCode[] = []): RiskFindings {
  return {
    answers: [answerOf(flags)],
    roundTrip: {
      kind: "measured",
      buyTaxBps: bps(snipe),
      hookFeeBps: bps(0),
      transferTaxBps: bps(0),
      sellTaxBps: bps(0),
    },
    limits: { maxTaxBps: bps(max), liquidityFloorUsdMicros: 10_000_000_000n },
    checkedAtMs: 1_000,
    snipeTaxBps: bps(snipe),
  };
}

describe("the launch window in the risk verdict, for any snipe tax and maximum", () => {
  it("blocks the buy as snipe_tax exactly when the snipe tax tops the maximum", () => {
    fc.assert(
      fc.property(taxes, taxes, (snipe, max) => {
        const assessment = riskVerdict(findingsOf(snipe, max));
        expect(assessment.refusal === "snipe_tax").toBe(snipe > max);
        expect(assessment.refusal === undefined).toBe(snipe <= max);
        expect(assessment.view.verdict === "block").toBe(snipe > max);
      }),
    );
  });

  it("keeps a harder finding's reason before the snipe tax", () => {
    fc.assert(
      fc.property(taxes, taxes, (snipe, max) => {
        expect(riskVerdict(findingsOf(snipe, max, ["honeypot"])).refusal).toBe("honeypot");
      }),
    );
  });
});
