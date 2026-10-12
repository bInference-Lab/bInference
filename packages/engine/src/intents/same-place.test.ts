import type { TradePlace } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { isSamePlace } from "./same-place.js";

const curve = { kind: "curve", launchpad: "fake-curve" } as const;
const pools = { kind: "pools" } as const;
const otherCurve = { kind: "curve", launchpad: "other-curve" } as const;

interface Row {
  readonly name: string;
  readonly before: TradePlace | undefined;
  readonly now: TradePlace | undefined;
  readonly isSame: boolean;
}

describe("the same place", () => {
  it.each<Row>([
    { name: "one launchpad's curve", before: curve, now: curve, isSame: true },
    { name: "the pools", before: pools, now: pools, isSame: true },
    { name: "no place either time", before: undefined, now: undefined, isSame: true },
    { name: "a curve and the pools", before: curve, now: pools, isSame: false },
    { name: "two launchpads' curves", before: curve, now: otherCurve, isSame: false },
    { name: "a place and none", before: curve, now: undefined, isSame: false },
  ])("compares $name", ({ before, now, isSame }) => {
    expect(isSamePlace(before, now)).toBe(isSame);
  });
});
