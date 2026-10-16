import { chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { describe, expect, it } from "vitest";
import { gweiToWei } from "./gwei-to-wei.js";

const bscRef = chainRefSchema.parse(bsc.id);

describe("a fee cap in gwei", () => {
  it.each([
    ["1", 1_000_000_000n],
    ["0.05", 50_000_000n],
    ["2.5", 2_500_000_000n],
    ["0.000000001", 1n],
  ])("reads %s gwei as %d wei", (gwei, wei) => {
    expect(gweiToWei(gwei, bscRef)).toBe(wei);
  });

  it.each(["0.0000000001", "1e9", "-1", ""])("refuses %j", (gwei) => {
    expect(() => gweiToWei(gwei, bscRef)).toThrow(
      expect.objectContaining({ code: "cli.bad_fee_cap" }),
    );
  });
});
