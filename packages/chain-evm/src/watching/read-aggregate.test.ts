import { createManualClock } from "@binference/core/testing";
import { encodeFunctionResult, getAddress, type Hex, multicall3Abi } from "viem";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp, type FakeEndpoint, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { readAggregate } from "./read-aggregate.js";

const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const target = getAddress("0x00000000000000000000000000000000000000aa");
const signal = new AbortController().signal;
const calls = [
  { target, callData: "0x01" as Hex },
  { target, callData: "0x02" as Hex },
];

// The first call answers; the second reverts.
const firstOnly = ({ callData }: { readonly callData: Hex }): Hex | undefined =>
  callData === "0x01" ? "0xbeef" : undefined;

function rpcOver(endpoint: FakeEndpoint) {
  return createRpcFailover({
    endpoints: [{ name: "node", url: "https://node.test" }],
    http: createFakeRpcHttp({ "https://node.test": endpoint }),
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1,
  });
}

describe("aggregate read", () => {
  it("answers each call's data in order, and undefined for one that reverted", async () => {
    const node = createFakeEvmNode({
      multicall,
      head: 7n,
      answer: firstOnly,
    });
    const answers = await readAggregate(rpcOver(node.endpoint), {
      multicall,
      calls,
      block: 7n,
      signal,
    });
    expect(answers).toStrictEqual(["0xbeef", undefined]);
    expect(node.batches()).toStrictEqual([{ block: 7n, calls: 2 }]);
  });

  it("refuses an answer that is not one result per call", async () => {
    const one = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [{ success: true, returnData: "0x" }],
    });
    await expect(
      readAggregate(rpcOver(fakeRpcNode(() => ({ result: one }))), { multicall, calls, signal }),
    ).rejects.toMatchObject({ code: "chain.multicall_mismatch" });
    await expect(
      readAggregate(rpcOver(fakeRpcNode(() => ({ result: "0x1234" }))), {
        multicall,
        calls,
        signal,
      }),
    ).rejects.toMatchObject({ code: "chain.multicall_mismatch" });
  });

  it("moves to the next endpoint within the read's own timeout", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer: firstOnly });
    const clock = createManualClock();
    const rpc = createRpcFailover({
      endpoints: [
        { name: "slow", url: "https://slow.test" },
        { name: "node", url: "https://node.test" },
      ],
      http: createFakeRpcHttp({ "https://slow.test": "hang", "https://node.test": node.endpoint }),
      clock,
      timeoutMs: 5_000,
      restMs: 1,
    });
    const answers = readAggregate(rpc, { multicall, calls, signal, timeoutMs: 300 });
    await clock.advance(300);
    await expect(answers).resolves.toStrictEqual(["0xbeef", undefined]);
    expect(clock.now()).toBe(300);
  });
});
