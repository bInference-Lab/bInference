import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { keyBelongs } from "./key-belongs.js";

// Hardhat's first test account: a key every EVM tool derives the same address from.
const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const on = (text: string) => accountRefSchema.parse(`eip155:56:${text}`);

describe("keyBelongs", () => {
  it("holds for the key of an EVM wallet's address, in any case and with or without 0x", () => {
    expect(keyBelongs(key, on(address))).toBe(true);
    expect(keyBelongs(key.slice(2).toUpperCase(), on(address.toLowerCase()))).toBe(true);
  });

  it("fails another wallet's key and text that is no key", () => {
    const other = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect(keyBelongs(key, on(other))).toBe(false);
    expect(keyBelongs("0x1234", on(address))).toBe(false);
    expect(keyBelongs(`0x${"0".repeat(64)}`, on(address))).toBe(false);
  });

  it("leaves a wallet of a family with no derivation here as its own", () => {
    expect(keyBelongs("any", accountRefSchema.parse("fake:1:0x0000000c"))).toBe(true);
  });
});
