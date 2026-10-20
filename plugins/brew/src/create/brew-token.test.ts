import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { tokenAddressOf } from "./brew-token.js";

// TapeBrew (TAPEBREW), launched through BrewFactory on BSC in
// 0xa90ed170504c7b3bb62ffb28d3140e1892b2e75ce6d66b5f7542c9c328a71409, block 128777000 or so: its
// call's words and salt, and the token the factory made.
const tapeBrew = {
  factory: getAddress("0xeEa6C3bfb29Fd9a35380438956bae7B109c63d85"),
  creator: getAddress("0x3cb2460Fb3b1b87743287C3d39f1F8f381C29705"),
  name: "TapeBrew",
  symbol: "TapeBrew",
  totalSupply: 10n ** 27n,
  metadataURI:
    "data:application/json;base64,eyJ2IjoxLCJpbWFnZSI6Im9uY2hhaW46Ly81Ni8weGUzOTUxMTU0NWU1OWU3NWI1MmMwYTFlN2ZkZGZmMTg3ZmVmNmFhYTkifQ==",
};
const salt = "0xc505f869f1db6b585da48c97bc3c7cc5b549b01e8c7098009feb7e789f3ed4cc";

describe("a BrewToken's address", () => {
  it("is the one BrewFactory gave a real launch, from its creation code, words and salt", () => {
    expect(tokenAddressOf(tapeBrew, salt)).toBe("0xA3d7A8E4De5Fa7e0E837059EEB7669988ed16666");
  });

  it("moves with any word the token commits to", () => {
    const moved = tokenAddressOf({ ...tapeBrew, symbol: "TAPE" }, salt);
    expect(moved).not.toBe("0xA3d7A8E4De5Fa7e0E837059EEB7669988ed16666");
  });
});
