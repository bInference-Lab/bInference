import type { FinalityRule, TxHash } from "@binference/chain";
import { receiptReaderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { createEvmReceiptReader } from "./create-evm-receipt-reader.js";

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const url = "https://node.invalid/";
const hashOf = (byte: string) => `0x${byte.repeat(32)}` as TxHash;
const succeeded = hashOf("aa");
const reverted = hashOf("bb");
const unknown = hashOf("cc");
const live = () => ({ signal: new AbortController().signal });

function receiptOf(hash: string, status: string): JsonValue {
  return {
    transactionHash: hash,
    blockNumber: "0x60",
    blockHash: `0x${"DE".repeat(32)}`,
    status,
    gasUsed: "0x5208",
    effectiveGasPrice: "0x2faf080",
    logs: [],
  };
}

function answer(method: string, params: readonly JsonValue[]): FakeRpcAnswer {
  const [first] = params;
  switch (method) {
    case "eth_getTransactionReceipt":
      if (first === succeeded) {
        return { result: receiptOf(succeeded, "0x1") };
      }
      return { result: first === reverted ? receiptOf(reverted, "0x0") : null };
    case "eth_blockNumber":
      return { result: "0x64" };
    case "eth_getBlockByNumber":
      return { result: { number: first === "finalized" ? "0x62" : "0x64", hash: "0xab" } };
    default:
      return { error: { code: -32_601, message: "method not found" } };
  }
}

// A node whose finalized block is ahead of its latest one, as two nodes behind a balancer can be.
function aheadAnswer(method: string, params: readonly JsonValue[]): FakeRpcAnswer {
  return method === "eth_getBlockByNumber"
    ? { result: { number: "0x70", hash: "0xab" } }
    : answer(method, params);
}

function readerOf(finality: FinalityRule, answers = answer) {
  const http = createFakeRpcHttp({
    [url]: fakeRpcNode((request) => answers(request.method, request.params)),
  });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return createEvmReceiptReader({ rpc, chain, finality });
}

describe("the EVM receipt reader", () => {
  it.each(
    receiptReaderContract({
      create: async () =>
        await Promise.resolve({
          reader: readerOf({ kind: "finalized_tag" }),
          chain: chain.ref,
          succeeded,
          reverted,
          unknown,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads the block, the gas used and the fee per gas paid", async () => {
    const receipt = await readerOf({ kind: "finalized_tag" }).receipt(chain.ref, succeeded, live());
    expect(receipt).toStrictEqual({
      hash: succeeded,
      block: { number: 96n, hash: `0x${"de".repeat(32)}` },
      status: "success",
      gasUsed: 21_000n,
      feePerGasBase: 50_000_000n,
    });
  });

  it("takes the final block from the finalized tag, never above the latest", async () => {
    await expect(
      readerOf({ kind: "finalized_tag" }).head(chain.ref, live()),
    ).resolves.toStrictEqual({ latest: 100n, final: 98n });
    await expect(
      readerOf({ kind: "finalized_tag" }, aheadAnswer).head(chain.ref, live()),
    ).resolves.toStrictEqual({ latest: 100n, final: 100n });
  });

  it("counts confirmations below the latest block on a chain without the tag", async () => {
    await expect(
      readerOf({ kind: "confirmations", blocks: 15 }).head(chain.ref, live()),
    ).resolves.toStrictEqual({ latest: 100n, final: 85n });
    await expect(
      readerOf({ kind: "confirmations", blocks: 200 }).head(chain.ref, live()),
    ).resolves.toStrictEqual({ latest: 100n, final: 0n });
  });

  it("reads one chain only", async () => {
    const reader = readerOf({ kind: "finalized_tag" });
    const other = "eip155:1" as typeof chain.ref;
    const outcomes = await Promise.allSettled([
      reader.receipt(other, succeeded, live()),
      reader.head(other, live()),
    ]);
    expect(outcomes).toMatchObject([
      { status: "rejected", reason: { code: "chain.unknown_chain" } },
      { status: "rejected", reason: { code: "chain.unknown_chain" } },
    ]);
  });
});
