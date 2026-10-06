import { encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { decodeCall } from "./decode-call.js";

const spender = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const routerAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

describe("decode call", () => {
  it("gives the function name and typed arguments", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, 5n],
    });
    expect(decodeCall(erc20Abi, data)).toStrictEqual({
      ok: true,
      value: { functionName: "approve", args: [spender, 5n] },
    });
  });

  it("decodes a router call with a path and a deadline", () => {
    const path = [spender, "0x55d398326f99059fF775485246999027B3197955"] as const;
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "swapExactETHForTokens",
      args: [1n, path, spender, 1_700_000_000n],
    });
    const decoded = decodeCall(routerAbi, data);
    expect(decoded).toStrictEqual({
      ok: true,
      value: { functionName: "swapExactETHForTokens", args: [1n, path, spender, 1_700_000_000n] },
    });
  });

  it("answers a selector the abi does not hold as an unknown function", () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "totalSupply" });
    expect(decodeCall(routerAbi, data)).toStrictEqual({ ok: false, error: "unknown_function" });
  });

  it.each([
    ["no selector", "0x"],
    ["half a selector", "0x095e"],
    ["arguments cut short", "0x095ea7b30000000000000000000000000000"],
  ])("answers %s as malformed calldata", (_case, data) => {
    expect(decodeCall(erc20Abi, data as `0x${string}`)).toStrictEqual({
      ok: false,
      error: "malformed_calldata",
    });
  });
});
