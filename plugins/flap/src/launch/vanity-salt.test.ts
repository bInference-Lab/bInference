import { createSeededRandom } from "@binference/plugin-sdk/testing";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { findTaxTokenSalt, isTaxTokenAddress, tokenAddressOf } from "./vanity-salt.js";

const maker = {
  portal: getAddress("0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0"),
  implementation: getAddress("0x024f18294970B5c76c0691b87f138A0317156422"),
};

describe("a Flap tax token's salt", () => {
  it("gives the address the Portal gave a token launched on BSC with it", () => {
    const salt = "0xfa46d944e827c386aa1f9207cbd6e50a331ca1d51228261ac83939d2a0119f0a";
    expect(tokenAddressOf(maker, salt)).toBe("0x01D47b3fDF1E9CaA63c69c6F0B08449a89417777");
  });

  it("is found off line for an address that ends in 7777", () => {
    const signal = new AbortController().signal;
    const found = findTaxTokenSalt(maker, { random: createSeededRandom(271), signal });
    expect(found.token).toBe(tokenAddressOf(maker, found.salt));
    expect(isTaxTokenAddress(found.token)).toBe(true);
  });

  it("does not start once its signal aborted", () => {
    const reason = new Error("stopped");
    const signal = AbortSignal.abort(reason);
    expect(() => findTaxTokenSalt(maker, { random: createSeededRandom(271), signal })).toThrow(
      reason,
    );
  });
});
