import { createManualClock } from "@binference/core/testing";
import { getAddress, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeRpcHttp, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { readHasCode } from "./read-has-code.js";

const at = (byte: number) => getAddress(toHex(byte, { size: 20 }));
const signal = new AbortController().signal;

// A node where address 1 holds code and every other address none; it refuses other methods.
const node = fakeRpcNode(({ method, params }) => {
  if (method !== "eth_getCode") {
    return { error: { code: -32_601, message: "the method does not exist" } };
  }
  return { result: params[0] === at(1) ? "0x6080604052" : "0x" };
});

const rpc = createRpcFailover({
  endpoints: [{ name: "node", url: "https://node.test" }],
  http: createFakeRpcHttp({ "https://node.test": node }),
  clock: createManualClock(),
  timeoutMs: 1_000,
  restMs: 1,
});

describe("reading whether an address holds code", () => {
  it("answers true for a contract and false for an address with none", async () => {
    await expect(readHasCode(rpc, { address: at(1), signal })).resolves.toBe(true);
    await expect(readHasCode(rpc, { address: at(2), signal })).resolves.toBe(false);
  });

  it("stops with the signal's reason once it aborts", async () => {
    const reason = new Error("stopped");
    const stopped = AbortSignal.abort(reason);
    await expect(readHasCode(rpc, { address: at(1), signal: stopped })).rejects.toBe(reason);
  });
});
