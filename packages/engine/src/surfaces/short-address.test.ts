import { describe, expect, it } from "vitest";
import { addressPartOf, shortAddress } from "./short-address.js";

describe("short addresses", () => {
  it("shows an address by its first 6 and last 4 characters", () => {
    expect(shortAddress("0x6982508145454Ce325dDbE47a25d4ec3d2311933")).toBe("0x6982…1933");
  });

  it("keeps an address too short to cut", () => {
    expect(shortAddress("0x1234abcd")).toBe("0x1234abcd");
  });

  it("reads the address of an account and the reference of an asset", () => {
    expect(addressPartOf("fake:1:0xAbCd")).toBe("0xAbCd");
    expect(addressPartOf("fake:1/erc20:0x6982")).toBe("0x6982");
  });
});
