import { accountRefSchema } from "@binference/chain";
import { txPreparerContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { encodeEvmDraft } from "../drafts/evm-draft.js";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { decodeEvmTransaction } from "../signing/evm-transaction.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { createEvmTxPreparer } from "./create-evm-tx-preparer.js";

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const url = "https://node.invalid/";
const user = accountRefSchema.parse("eip155:56:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
const router = accountRefSchema.parse("eip155:56:0x10ED43C718714eb63d5aA57B78B54704E256024E");
const swap = encodeEvmDraft({ from: user, to: router, value: 10n ** 17n, data: "0x7ff36ab5" });
const reverting = encodeEvmDraft({ from: user, to: router, value: 0n, data: "0xdeadbeef" });
const live = () => ({ signal: new AbortController().signal });
const floor = 50_000_000n;

function nodeAnswer(method: string, params: readonly unknown[]): FakeRpcAnswer {
  switch (method) {
    case "eth_estimateGas":
      return JSON.stringify(params).includes("0xdeadbeef")
        ? { error: { code: 3, message: "execution reverted" } }
        : { result: "0x186a0" };
    case "eth_maxPriorityFeePerGas":
      return { result: "0x2faf080" };
    case "eth_getBlockByNumber":
      return { result: { number: "0x64", baseFeePerGas: "0x0" } };
    default:
      return { error: { code: -32_601, message: "method not found" } };
  }
}

function preparerOf(networkFeeCap: bigint, gasHeadroomBps?: number) {
  const http = createFakeRpcHttp({
    [url]: fakeRpcNode((request) => nodeAnswer(request.method, request.params)),
  });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  const headroom = gasHeadroomBps === undefined ? {} : { gasHeadroomBps };
  return { http, preparer: createEvmTxPreparer({ rpc, chain, networkFeeCap, ...headroom }) };
}

function decoded(unsigned: Parameters<typeof decodeEvmTransaction>[0]) {
  const transaction = decodeEvmTransaction(unsigned);
  if (!transaction.ok) {
    throw new Error("Expected an unsigned type-2 transaction.");
  }
  return transaction.value;
}

async function preparedOf(preparer: ReturnType<typeof preparerOf>["preparer"], nonce: number) {
  const prepared = await preparer.prepare({ draft: swap, nonce }, live());
  if (!prepared.ok) {
    throw new Error("Expected the draft to prepare.");
  }
  return prepared.value;
}

interface RpcCallBody {
  readonly method: string;
  readonly params: unknown;
}

describe("the EVM transaction preparer", () => {
  it.each(
    txPreparerContract({
      create: async (feeCapBase) =>
        await Promise.resolve({
          preparer: preparerOf(feeCapBase).preparer,
          draft: swap,
          failing: reverting,
          nonceOf: (unsigned) => decoded(unsigned).nonce,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("signs for the estimate plus 20% gas, at the fees read now", async () => {
    const { preparer } = preparerOf(10n ** 9n);
    const prepared = await preparedOf(preparer, 3);
    expect(prepared.feePerGasBase).toBe(floor);
    expect(decoded(prepared.unsigned)).toStrictEqual({
      chainId: 56,
      from: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      to: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
      value: 10n ** 17n,
      data: "0x7ff36ab5",
      nonce: 3,
      gas: 120_000n,
      fees: { maxFeePerGas: floor, maxPriorityFeePerGas: floor },
    });
  });

  it("estimates from the sender on the latest block, with the headroom it is given", async () => {
    const { preparer, http } = preparerOf(10n ** 9n, 0);
    const prepared = await preparedOf(preparer, 0);
    expect(decoded(prepared.unsigned).gas).toBe(100_000n);
    const estimate = http
      .requests()
      .map((request) => JSON.parse(String(request.body)) as RpcCallBody)
      .find((call) => call.method === "eth_estimateGas");
    expect(estimate?.params).toStrictEqual([
      {
        from: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        to: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
        value: "0x16345785d8a0000",
        data: "0x7ff36ab5",
      },
      "latest",
    ]);
  });

  it("refuses a draft of another chain or one it cannot read", async () => {
    const { preparer } = preparerOf(10n ** 9n);
    const elsewhere = { ...swap, chain: "eip155:1" } as typeof swap;
    const unreadable = { ...swap, payload: "0x01" };
    const outcomes = await Promise.allSettled([
      preparer.prepare({ draft: elsewhere, nonce: 0 }, live()),
      preparer.prepare({ draft: unreadable, nonce: 0 }, live()),
    ]);
    expect(outcomes).toMatchObject([
      { status: "rejected", reason: { code: "chain.bad_draft" } },
      { status: "rejected", reason: { code: "chain.bad_draft" } },
    ]);
  });
});
