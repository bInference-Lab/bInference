import { describe, expect, it } from "vitest";
import { readHeads } from "./abi-heads.schema.js";

const word = (hex: string): string => hex.padStart(64, "0");
const selector = "0x12345678";

// A function shaped like OKX's `dagSwapTo`: a static tuple of five words sits between `receiver`
// and the offset of a dynamic array, and a fixed array of two words follows it.
const abi = {
  type: "function",
  name: "swapTo",
  inputs: [
    { name: "orderId", type: "uint256" },
    { name: "receiver", type: "address" },
    {
      name: "base",
      type: "tuple",
      components: ["uint256", "address", "uint256", "uint256", "uint256"].map((type, index) => ({
        name: `p${String(index)}`,
        type,
      })),
    },
    { name: "pair", type: "address[2]" },
    { name: "paths", type: "tuple[]", components: [{ name: "to", type: "address[]" }] },
    { name: "last", type: "uint256" },
  ],
};

const data = [
  selector,
  word("1"),
  word("aa".repeat(20)),
  ...["2", "bb", "3", "4", "5"].map(word),
  word("cc".repeat(20)),
  word("dd".repeat(20)),
  word("200"),
  word("63"),
].join("");

describe("reading a call's head words", () => {
  it("places each input after the heads before it, a static tuple and a fixed array inline", () => {
    const heads = readHeads(abi, data);
    expect(heads?.words.get("receiver")).toBe(word("aa".repeat(20)));
    expect(heads?.words.get("paths")).toBe(word("200"));
    expect(heads?.words.get("last")).toBe(word("63"));
  });

  it("reads nothing from calldata too short for its heads, or from a type it cannot size", () => {
    expect(readHeads(abi, data.slice(0, -64))).toBeUndefined();
    const odd = { ...abi, inputs: [{ name: "x", type: "function" }] };
    expect(readHeads(odd, data)).toBeUndefined();
  });
});
