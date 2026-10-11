import { parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { callAbiJson } from "./call-abi-json.js";

describe("callAbiJson", () => {
  it("writes a function with tuple inputs as plain JSON, components and all", () => {
    const item = parseAbiItem([
      "struct Pair { address token; uint256 amount; }",
      "function swap(uint256 id, Pair pair) payable returns (uint256)",
    ]);
    expect(callAbiJson(item)).toStrictEqual({
      type: "function",
      name: "swap",
      inputs: [
        { name: "id", type: "uint256" },
        {
          name: "pair",
          type: "tuple",
          components: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
      ],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "payable",
    });
  });
});
