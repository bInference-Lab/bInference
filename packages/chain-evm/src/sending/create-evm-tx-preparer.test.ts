import {
  accountRefSchema,
  chainRefSchema,
  type SignedTx,
  type UnsignedTx,
} from "@binference/chain";
import { txPreparerContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { keccak256, parseTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { decodeEvmDraft, encodeEvmDraft } from "../drafts/evm-draft.js";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { decodeEvmTransaction, encodeEvmTransaction } from "../signing/evm-transaction.js";
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
// A throwaway key from fixed words: the preparer reads signed bytes, never who signed them.
const signer = privateKeyToAccount(keccak256(toHex("binference chain-evm preparer test")));

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

function preparerOf(networkFeeCapWeiPerGas: bigint, gasHeadroomBps?: number) {
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
  return {
    http,
    preparer: createEvmTxPreparer({ rpc, chain, networkFeeCapWeiPerGas, ...headroom }),
  };
}

function decodeEvmDraftCall(draft: typeof swap) {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    throw new Error("Expected an EVM draft.");
  }
  return call.value;
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

async function signed(unsigned: UnsignedTx): Promise<SignedTx> {
  const fields = parseTransaction(unsigned.payload as `0x${string}`);
  return { chain: unsigned.chain, raw: await signer.signTransaction(fields) };
}

// The reverting call, signed at a nonce before it began to revert.
async function signedFailing(nonce: number): Promise<SignedTx> {
  const fees = { maxFeePerGas: floor, maxPriorityFeePerGas: floor };
  const call = decodeEvmDraftCall(reverting);
  return signed(encodeEvmTransaction(chain, { ...call, nonce, gas: 100_000n, fees }));
}

function callOf(unsigned: UnsignedTx) {
  const { to, value, data } = decoded(unsigned);
  return { to: evmAccountRef(chain, to), value, data };
}

function valueOf<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected the preparer to prepare.");
  }
  return result.value;
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
          callOf,
          sign: signed,
          signFailing: signedFailing,
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

  it.each([
    ["below the chain's", 50_000_000n, 55_000_000n],
    ["far below the chain's", 10_000_000n, floor],
  ])("raises both fees of a replacement signed %s to replace it", async (_, before, after) => {
    const { preparer } = preparerOf(10n ** 9n);
    const fees = { maxFeePerGas: before, maxPriorityFeePerGas: before };
    const call = decodeEvmDraftCall(swap);
    const replaced = await signed(
      encodeEvmTransaction(chain, { ...call, nonce: 9, gas: 1n, fees }),
    );
    const replacement = valueOf(
      await preparer.replace({ kind: "speedUp", from: user, replaced }, live()),
    );
    expect(replacement.feePerGasBase).toBe(after);
    expect(decoded(replacement.unsigned)).toMatchObject({
      nonce: 9,
      gas: 120_000n,
      fees: { maxFeePerGas: after, maxPriorityFeePerGas: after },
    });
  });

  it("refuses signed bytes of another chain, no type-2 call, or a sender elsewhere", async () => {
    const { preparer } = preparerOf(10n ** 9n);
    const replaced = await signed((await preparedOf(preparer, 0)).unsigned);
    const elsewhere = accountRefSchema.parse("eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    const outcomes = await Promise.allSettled([
      preparer.replace(
        { kind: "cancel", from: user, replaced: { ...replaced, raw: "0x01" } },
        live(),
      ),
      preparer.replace(
        {
          kind: "cancel",
          from: user,
          replaced: { ...replaced, chain: chainRefSchema.parse("eip155:1") },
        },
        live(),
      ),
      preparer.replace({ kind: "cancel", from: elsewhere, replaced }, live()),
    ]);
    expect(outcomes).toMatchObject([
      { status: "rejected", reason: { code: "chain.bad_transaction" } },
      { status: "rejected", reason: { code: "chain.bad_transaction" } },
      { status: "rejected", reason: { code: "chain.unknown_chain" } },
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
