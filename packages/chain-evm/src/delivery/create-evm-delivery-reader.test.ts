import {
  type AccountRef,
  type AssetRef,
  accountRefSchema,
  type ReceiptReader,
  type TxHash,
} from "@binference/chain";
import { deliveryReaderContract } from "@binference/chain/testing";
import { err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { createEvmReceiptReader } from "../sending/create-evm-receipt-reader.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { createEvmDeliveryReader } from "./create-evm-delivery-reader.js";
import recorded from "./recorded/arbitrum-usdc-fill.json" with { type: "json" };

// An Across fill from BSC on Arbitrum One, as its RPC answered it (see the fixture's source).
const chain = {
  ref: "eip155:42161",
  chainId: 42_161,
  name: "Arbitrum One",
  nativeAsset: "eip155:42161/slip44:60",
  nativeSymbol: "ETH",
  nativeDecimals: 18,
} as EvmChain;
const url = "https://node.invalid/";
const fill = "0xf808ab59453dcde518dd2566d067aedd9496a80453210a9cbb2379b417ba9aa1" as TxHash;
const recipient = "eip155:42161:0x168E0c5AE6B259883D878C89C042ad6347F8ba85" as AccountRef;
const usdc = "eip155:42161/erc20:0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as AssetRef;
const reverted = `0x${"bb".repeat(32)}` as TxHash;
const unknown = `0x${"cc".repeat(32)}` as TxHash;
const multicall = "0xcA11bde05977b3631167028862bE2a173976CA11";
const live = () => ({ signal: new AbortController().signal });

const recordedAnswers = new Map(
  recorded.answers.map(({ method, params, result }) => [
    `${method}${JSON.stringify(params)}`,
    result as JsonValue,
  ]),
);
const fillReceipt = recordedAnswers.get(`eth_getTransactionReceipt${JSON.stringify([fill])}`);

// The recorded fill, and two hashes the recording never saw: one that reverted, one unknown.
function answer(method: string, params: readonly JsonValue[]): FakeRpcAnswer {
  const [hash] = params;
  if (method === "eth_getTransactionReceipt" && hash === reverted) {
    const receipt = fillReceipt as Readonly<Record<string, JsonValue>>;
    return { result: { ...receipt, transactionHash: reverted, status: "0x0", logs: [] } };
  }
  if (hash === unknown) {
    return { result: null };
  }
  const result = recordedAnswers.get(`${method}${JSON.stringify(params)}`);
  return result === undefined ? { error: { code: -32_602, message: "not recorded" } } : { result };
}

function partsOf(): {
  readonly rpc: ReturnType<typeof createRpcFailover>;
  readonly receipts: ReceiptReader;
} {
  const http = createFakeRpcHttp({
    [url]: fakeRpcNode((request) => answer(request.method, request.params)),
  });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return {
    rpc,
    receipts: createEvmReceiptReader({ rpc, chain, finality: { kind: "finalized_tag" } }),
  };
}

function readerWith(nativeReceived: ReceiptReader["nativeReceived"]) {
  const { rpc, receipts } = partsOf();
  return createEvmDeliveryReader({
    rpc,
    chain,
    receipts: { ...receipts, nativeReceived },
    multicall,
  });
}

describe("the EVM delivery reader", () => {
  it.each(
    deliveryReaderContract({
      create: async () => {
        const { rpc, receipts } = partsOf();
        return await Promise.resolve({
          reader: createEvmDeliveryReader({ rpc, chain, receipts, multicall }),
          recipient,
          holding: { asset: usdc, base: 599_532_886n },
          delivered: fill,
          received: { asset: usdc, base: 288_148_284n },
          emitter: accountRefSchema.parse(
            "eip155:42161:0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
          ),
          failed: reverted,
          unknown,
          stranger: "eip155:56:0x168E0c5AE6B259883D878C89C042ad6347F8ba85" as AccountRef,
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads the coin a fill sent as the recipient's balance change across its block", async () => {
    const reader = readerWith(async (account, block) => {
      expect([account, block]).toStrictEqual([recipient, 519_488_631n]);
      return await Promise.resolve(ok(7_000n));
    });
    const delivery = await reader.delivery(
      { hash: fill, recipient, asset: chain.nativeAsset },
      live(),
    );
    expect(delivery?.received).toStrictEqual({ asset: chain.nativeAsset, base: 7_000n });
  });

  it("refuses a coin read whose block state every node pruned", async () => {
    const reader = readerWith(async () => await Promise.resolve(err("state_gone" as const)));
    const reading = reader.delivery({ hash: fill, recipient, asset: chain.nativeAsset }, live());
    await expect(reading).rejects.toMatchObject({ code: "chain.state_missing" });
  });

  it("reads a holding that shrank as nothing received", async () => {
    const reader = readerWith(async () => await Promise.resolve(ok(-5n)));
    const delivery = await reader.delivery(
      { hash: fill, recipient, asset: chain.nativeAsset },
      live(),
    );
    expect(delivery?.received.base).toBe(0n);
  });

  it("reads 0 of a token the fill never sent the recipient", async () => {
    const { rpc, receipts } = partsOf();
    const reader = createEvmDeliveryReader({ rpc, chain, receipts, multicall });
    const other = "eip155:42161/erc20:0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" as AssetRef;
    const delivery = await reader.delivery({ hash: fill, recipient, asset: other }, live());
    expect(delivery?.received).toStrictEqual({ asset: other, base: 0n });
  });

  it("refuses an asset of another chain", async () => {
    const { rpc, receipts } = partsOf();
    const reader = createEvmDeliveryReader({ rpc, chain, receipts, multicall });
    const asset = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955" as AssetRef;
    await expect(reader.delivery({ hash: fill, recipient, asset }, live())).rejects.toMatchObject({
      code: "chain.unknown_chain",
    });
  });
});
