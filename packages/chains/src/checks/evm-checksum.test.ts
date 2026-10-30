import { describe, expect, it } from "vitest";
import { isChecksummed } from "./evm-checksum.js";

describe("the EIP-55 check", () => {
  // The test vectors from EIP-55 itself.
  it.each([
    "0x52908400098527886E0F7030069857D2E4169EE7",
    "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
    "0xde709f2102306220921060314715629080e2fb77",
    "0x27b1fdb04752bbc536007a920d24acb045561c26",
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ])("accepts the EIP-55 vector %s", (address) => {
    expect(isChecksummed(address)).toBe(true);
  });

  it.each([
    ["all lower case", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"],
    ["all upper case", "0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED"],
    ["one letter flipped", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"],
    ["a short address", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA"],
    ["no 0x prefix", "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"],
  ])("refuses an address with %s", (_case, address) => {
    expect(isChecksummed(address)).toBe(false);
  });
});
