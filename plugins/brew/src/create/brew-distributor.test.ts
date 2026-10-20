import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { distributorAddressOf } from "./brew-distributor.js";

// BrewDistributorFactory's own `predict` for TapeBrew, a real Brew token, read on BSC on
// 2026-10-20.
const factories = {
  distributorFactory: getAddress("0xd765972dD6a09Fa9c743b4708198A820FC5D31EE"),
  brewFactory: getAddress("0xeEa6C3bfb29Fd9a35380438956bae7B109c63d85"),
};
const tapeBrew = getAddress("0xA3d7A8E4De5Fa7e0E837059EEB7669988ed16666");
const predicted = "0x741cc05c80d1a43B620f6750cc648726a827E7a5";

describe("a Brew token's holder distributor address", () => {
  it("is the one the distributor factory predicts, from its creation code and the token", () => {
    expect(distributorAddressOf(factories, tapeBrew)).toBe(predicted);
  });

  it("moves with the token and with either factory", () => {
    const other = getAddress("0x00000000000000000000000000000000000000E1");
    const moved = [
      distributorAddressOf(factories, other),
      distributorAddressOf({ ...factories, brewFactory: other }, tapeBrew),
      distributorAddressOf({ ...factories, distributorFactory: other }, tapeBrew),
    ];
    expect(moved).not.toContain(predicted);
  });
});
