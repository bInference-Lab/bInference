import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { approveCalldata, transferCalldata } from "../testing/sign-fixtures.js";
import { readTokenCall } from "./token-call.js";

const spender = "0x13f4ea83d0bd40e75c8222255bc855a974568dd4";
const address = fc.stringMatching(/^0x[0-9a-f]{40}$/);
const uint256 = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });

describe("token calls in calldata", () => {
  // Calldata written by hand from the ABI: selector, the address padded to 32 bytes, the amount.
  it("reads a known approve and a known transfer", () => {
    const amount = "00000000000000000000000000000000000000000000000000000000000003e8";
    const padded = `000000000000000000000000${spender.slice(2)}`;

    expect(readTokenCall(`0x095ea7b3${padded}${amount}`)).toStrictEqual({
      kind: "approve",
      spender,
      amount: 1000n,
    });
    expect(readTokenCall(`0xa9059cbb${padded}${amount}`)).toStrictEqual({
      kind: "transfer",
      recipient: spender,
      amount: 1000n,
    });
  });

  it("reads back any approve and transfer it is given", () => {
    fc.assert(
      fc.property(address, uint256, (account, amount) => {
        expect(readTokenCall(approveCalldata(account, amount))).toStrictEqual({
          kind: "approve",
          spender: account,
          amount,
        });
        expect(readTokenCall(transferCalldata(account, amount))).toStrictEqual({
          kind: "transfer",
          recipient: account,
          amount,
        });
      }),
    );
  });

  it.each([
    ["transferFrom", `0x23b872dd${"0".repeat(192)}`],
    ["increaseAllowance", `0x39509351${"0".repeat(128)}`],
    ["setApprovalForAll", `0xa22cb465${"0".repeat(128)}`],
    ["Permit2's approve", `0x87517c45${"0".repeat(256)}`],
    ["an approve with a byte too many", `${approveCalldata(spender, 1n)}00`],
    ["an approve cut short", approveCalldata(spender, 1n).slice(0, -2)],
    ["a transfer whose address has bits above 160", `0xa9059cbb${"1".repeat(64)}${"0".repeat(64)}`],
  ])("counts %s as another token call", (_case, data) => {
    expect(readTokenCall(data)).toStrictEqual({ kind: "otherTokenCall" });
  });

  it.each([
    ["no calldata", "0x"],
    ["a router call", "0x7ff36ab5"],
    ["three bytes", "0x095ea7"],
  ])("counts %s as no token call", (_case, data) => {
    expect(readTokenCall(data)).toStrictEqual({ kind: "notTokenCall" });
  });
});
