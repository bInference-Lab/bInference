import { accountRefSchema } from "@binference/chain";
import { accountCodeReaderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { encodeFunctionData, erc20Abi, getAddress, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { createEvmAccountCodeReader } from "./create-evm-account-code-reader.js";

const chain = {
  ref: "eip155:8453",
  chainId: 8453,
  name: "Base",
  nativeAsset: "eip155:8453/slip44:60",
  nativeSymbol: "ETH",
  nativeDecimals: 18,
} as EvmChain;
const at = (byte: number) => getAddress(toHex(byte, { size: 20 }));
const account = (byte: number) => accountRefSchema.parse(`eip155:8453:${at(byte)}`);
const word = (value: bigint) => toHex(value, { size: 32 });
const supplyCall = encodeFunctionData({ abi: erc20Abi, functionName: "totalSupply" });
const decimalsCall = encodeFunctionData({ abi: erc20Abi, functionName: "decimals" });
const reverted: FakeRpcAnswer = { error: { code: 3, message: "execution reverted" } };
const live = () => ({ signal: new AbortController().signal });

// Address 1 holds nothing, 2 a delegation, 3 a token, 4 a contract that reverts both calls, 5 one
// that answers decimals past a `uint8`, and 6 one that answers a supply but no decimals.
const codes: Readonly<Record<string, string>> = {
  [at(1)]: "0x",
  [at(2)]: `0xef0100${"11".repeat(20)}`,
};

function callAnswer(to: string, data: string): FakeRpcAnswer {
  const answers: Readonly<Record<string, Readonly<Record<string, FakeRpcAnswer>>>> = {
    [at(3)]: { [supplyCall]: { result: word(10n ** 24n) }, [decimalsCall]: { result: word(18n) } },
    [at(5)]: { [supplyCall]: { result: word(1n) }, [decimalsCall]: { result: word(256n) } },
    [at(6)]: { [supplyCall]: { result: word(1n) }, [decimalsCall]: { result: "0x" } },
  };
  return answers[to]?.[data] ?? reverted;
}

function answer(method: string, params: readonly JsonValue[]): FakeRpcAnswer {
  const [first] = params;
  if (method === "eth_getCode") {
    return { result: (typeof first === "string" ? codes[first] : undefined) ?? "0x6080604052" };
  }
  const [call] = params as readonly { readonly to: string; readonly data: string }[];
  return method === "eth_call" && call !== undefined ? callAnswer(call.to, call.data) : reverted;
}

function readerOf(endpoint: "answers" | "refuse" = "answers") {
  const url = "https://node.test";
  const node = fakeRpcNode(({ method, params }) => answer(method, params));
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http: createFakeRpcHttp({ [url]: endpoint === "answers" ? node : "refuse" }),
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1,
  });
  return createEvmAccountCodeReader({ rpc, chain });
}

describe("the evm account code reader", () => {
  it.each(
    accountCodeReaderContract({
      create: async () =>
        await Promise.resolve({
          reader: readerOf(),
          plain: account(1),
          delegated: account(2),
          token: account(3),
          contract: account(4),
          stranger: accountRefSchema.parse(`eip155:1:${at(1)}`),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a contract whose decimals pass a uint8, or that answers none, as no token", async () => {
    const reader = readerOf();
    await expect(reader.read(account(5), live())).resolves.toBe("contract");
    await expect(reader.read(account(6), live())).resolves.toBe("contract");
  });

  it("rejects when no endpoint answers", async () => {
    await expect(readerOf("refuse").read(account(1), live())).rejects.toBeDefined();
  });
});
