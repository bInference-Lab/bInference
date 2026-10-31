import type { ChainCapPlan } from "@binference/custody-privy";
import { testCaps, testCeilingRequest, testChain } from "@binference/custody-privy/testing";
import { describe, expect, it } from "vitest";
import { withDayCaps } from "./resized-caps.js";

const [chain] = testCeilingRequest().chains;

function planWith(approvals: readonly bigint[]): ChainCapPlan {
  return {
    chain: testChain,
    nativeLimitBase: 7n,
    approvals: approvals.map((limitBase) => ({
      token: "0x52E30eafc87D104E67Dd8e1E16BE97191Ef2F99C",
      limitBase,
    })),
  };
}

function resized(approvals: readonly bigint[]) {
  return withDayCaps(chain === undefined ? [] : [chain], {
    dayUsdMicros: 1n,
    capPlanOn: () => planWith(approvals),
  })[0]?.caps;
}

describe("resizing a ceiling's 24-hour caps", () => {
  it("resizes each cap by its place, and keeps the caps of a ceiling made before one was added", () => {
    expect(resized([9n, 11n])).toStrictEqual({
      native: { aggregation: testCaps.native.aggregation, limitBase: 7n },
      approvals: [{ aggregation: testCaps.approvals[0]?.aggregation, limitBase: 9n }],
    });
  });

  it("stops when the ceiling names more token caps than binference sizes", () => {
    expect(() => resized([])).toThrow(expect.objectContaining({ code: "cli.ceiling_unbuilt" }));
  });
});
