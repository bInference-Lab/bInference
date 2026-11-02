import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type LandedStakeWire, landedStakeSchema } from "./landed-stake.js";

const coin = { asset: "fake:1/slip44:1", base: "1000" };
const shares = { asset: "fake:1/token:0x000000c1", base: "990" };
const validator = "fake:1:0x000000c1";

describe("a landed staking move on the wire", () => {
  it("decodes and encodes a stake, an unstake and a claim without a change", () => {
    const wires: readonly LandedStakeWire[] = [
      { action: "stake" as const, validator, moved: coin, shares },
      {
        action: "unstake" as const,
        validator,
        moved: coin,
        shares,
        request: { ref: "0x000000c1:0", amount: coin, readyAtMs: 1_800_000_000_000 },
      },
      { action: "claim" as const, validator, moved: coin, claimed: ["0x000000c1:0"] },
    ];
    expect(
      wires.map((wire) => z.encode(landedStakeSchema, z.decode(landedStakeSchema, wire))),
    ).toStrictEqual(wires);
  });

  it("refuses another action, a negative amount, an empty ref and a field it does not know", () => {
    const stake = { action: "stake", validator, moved: coin, shares };
    const wrong: readonly Readonly<Record<string, unknown>>[] = [
      { ...stake, action: "redelegate" },
      { ...stake, moved: { ...coin, base: "-1" } },
      { ...stake, claimed: [""] },
      { ...stake, request: { ref: "", amount: coin, readyAtMs: 0 } },
      { ...stake, beneficiary: validator },
      { ...stake, validator: "not an account" },
    ];
    expect(wrong.map((item) => landedStakeSchema.safeParse(item).success)).toStrictEqual(
      wrong.map(() => false),
    );
  });
});
