import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { readFees } from "./read-fees.js";

const url = "https://node.invalid/";
const floor = 50_000_000n;

function node(answers: Readonly<Record<string, FakeRpcAnswer>>) {
  return createRpcFailover({
    endpoints: [{ name: "node", url }],
    http: createFakeRpcHttp({
      [url]: fakeRpcNode(
        (request) => answers[request.method] ?? { error: { code: 3, message: "?" } },
      ),
    }),
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
}

function block(baseFeePerGas: string): FakeRpcAnswer {
  const result: JsonValue = { number: "0x7848998", baseFeePerGas, gasLimit: "0x42c1d80" };
  return { result };
}

const signal = new AbortController().signal;

describe("read fees", () => {
  it("pays the network floor on a chain whose base fee is zero", async () => {
    const rpc = node({
      eth_maxPriorityFeePerGas: { result: "0x2faf080" },
      eth_getBlockByNumber: block("0x0"),
    });
    await expect(readFees(rpc, { maxFeePerGasCap: 1_000_000_000n, signal })).resolves.toStrictEqual(
      {
        fees: { maxFeePerGas: floor, maxPriorityFeePerGas: floor },
        isAboveCap: false,
      },
    );
  });

  it("leaves room for twice the latest base fee", async () => {
    const rpc = node({
      eth_maxPriorityFeePerGas: { result: "0x2faf080" },
      eth_getBlockByNumber: block("0x3b9aca00"),
    });
    const fees = await readFees(rpc, { maxFeePerGasCap: 10_000_000_000n, signal });
    expect(fees).toStrictEqual({
      fees: { maxFeePerGas: 2_000_000_000n + floor, maxPriorityFeePerGas: floor },
      isAboveCap: false,
    });
  });

  it("returns fees above the caller's cap, marked for the owner's tap", async () => {
    const rpc = node({
      eth_maxPriorityFeePerGas: { result: "0x174876e800" },
      eth_getBlockByNumber: block("0x0"),
    });
    await expect(readFees(rpc, { maxFeePerGasCap: floor, signal })).resolves.toStrictEqual({
      fees: { maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 100_000_000_000n },
      isAboveCap: true,
    });
  });

  it("counts a fee cap per gas equal to the caller's cap as within it", async () => {
    const rpc = node({
      eth_maxPriorityFeePerGas: { result: "0x2faf080" },
      eth_getBlockByNumber: block("0x1"),
    });
    const atCap = await readFees(rpc, { maxFeePerGasCap: floor + 2n, signal });
    const belowCap = await readFees(rpc, { maxFeePerGasCap: floor + 1n, signal });
    expect([atCap.isAboveCap, belowCap.isAboveCap]).toStrictEqual([false, true]);
  });

  it("names the node's error when it refuses a fee read", async () => {
    const rpc = node({ eth_getBlockByNumber: block("0x0") });
    await expect(readFees(rpc, { maxFeePerGasCap: floor, signal })).rejects.toMatchObject({
      code: "chain.rpc_error",
      details: { method: "eth_maxPriorityFeePerGas", endpoint: "node", rpcCode: 3 },
    });
  });

  it("counts a block without a base fee as a malformed answer", async () => {
    const rpc = node({
      eth_maxPriorityFeePerGas: { result: "0x2faf080" },
      eth_getBlockByNumber: { result: { number: "0x1" } },
    });
    await expect(readFees(rpc, { maxFeePerGasCap: floor, signal })).rejects.toMatchObject({
      code: "chain.rpc_down",
      details: { lastFault: "malformed" },
    });
  });
});
