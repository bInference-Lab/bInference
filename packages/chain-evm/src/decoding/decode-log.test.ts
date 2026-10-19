import { encodeAbiParameters, pad, parseAbi, toEventSelector, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { decodeLog } from "./decode-log.js";

const abi = parseAbi(["event Moved(address indexed token, uint256 amount)"]);
const topics = [toEventSelector("Moved(address,uint256)"), pad(zeroAddress)];
const data = encodeAbiParameters([{ type: "uint256" }], [7n]);

describe("decodeLog", () => {
  it("decodes a log of one of the ABI's events with its arguments", () => {
    expect(decodeLog(abi, { topics, data })).toStrictEqual({
      eventName: "Moved",
      args: { token: zeroAddress, amount: 7n },
    });
  });

  it("passes over a log of another event, one with data too short, and parts that are no hex", () => {
    expect(decodeLog(abi, { topics: [`0x${"ab".repeat(32)}`], data })).toBeUndefined();
    expect(decodeLog(abi, { topics, data: "0x" })).toBeUndefined();
    expect(
      decodeLog(abi, { topics: [toEventSelector("Moved(address,uint256)"), "zz"], data }),
    ).toBeUndefined();
    expect(decodeLog(abi, { topics, data: "zz" })).toBeUndefined();
    expect(decodeLog(abi, { topics: [], data })).toBeUndefined();
  });
});
