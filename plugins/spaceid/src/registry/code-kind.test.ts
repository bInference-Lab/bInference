import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { codeKindOf } from "./code-kind.js";

// The delegate SPACE ID's own address names on BSC, read 2026-10-31.
const delegate = "63c0c19a282a1b52b07dd5a65b58948a07dae32b";

describe("codeKindOf", () => {
  it("reads no code as a plain account", () => {
    expect(codeKindOf("0x")).toBe("none");
  });

  it("reads an EIP-7702 designator of exactly 23 bytes as a smart-account wallet", () => {
    expect(codeKindOf(`0xef0100${delegate}`)).toBe("delegation");
    expect(codeKindOf(`0xEF0100${delegate.toUpperCase()}`)).toBe("delegation");
  });

  it("refuses a designator with a trailing byte as a contract", () => {
    expect(codeKindOf(`0xef0100${delegate}00`)).toBe("other");
  });

  const refused: readonly (readonly [string, Hex])[] = [
    ["one byte short", `0xef0100${delegate.slice(2)}`],
    ["the prefix alone", "0xef0100"],
    ["the magic alone", "0xef01"],
    ["another version byte", `0xef0101${delegate}`],
    ["another magic", `0xef0200${delegate}`],
    ["contract code", "0x608060405234801561001057600080fd5b50"],
  ];

  it.each(refused)("refuses %s as a contract", (_, code) => {
    expect(codeKindOf(code)).toBe("other");
  });
});
