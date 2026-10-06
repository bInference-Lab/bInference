import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeErrorResult,
  erc20Abi,
  RpcRequestError,
} from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createFakeRpcHttp, type FakeEndpoint, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { createEvmClient } from "./create-evm-client.js";
import { createRpcFailover } from "./create-rpc-failover.js";

const url = "https://node.invalid/";
const token = "0x55d398326f99059fF775485246999027B3197955";
const holder = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

const chain = {
  ref: "eip155:31337",
  chainId: 31_337,
  name: "Test Chain",
  nativeAsset: "eip155:31337/slip44:60",
  nativeSymbol: "TEST",
  nativeDecimals: 18,
} as EvmChain;

function client(endpoint: FakeEndpoint) {
  const http = createFakeRpcHttp({ [url]: endpoint });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { http, viem: createEvmClient({ chain, rpc, signal: new AbortController().signal }) };
}

// Answers eth_chainId with the test chain and every eth_call with a balance of 1,234.
const chainAndBalanceNode = fakeRpcNode((request) =>
  request.method === "eth_chainId"
    ? { result: "0x7a69" }
    : { result: encodeAbiParameters([{ type: "uint256" }], [1_234n]) },
);

function causeChain(error: unknown): readonly unknown[] {
  return error instanceof Error ? [error, ...causeChain(error.cause)] : [];
}

describe("evm client", () => {
  it("reads through the failover and decodes the answer", async () => {
    const { viem, http } = client(chainAndBalanceNode);
    await expect(viem.getChainId()).resolves.toBe(31_337);
    await expect(
      viem.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [holder],
      }),
    ).resolves.toBe(1_234n);
    expect(http.requests()).toHaveLength(2);
  });

  it("lets viem decode a revert the node answered", async () => {
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] }],
      errorName: "Error",
      args: ["insufficient balance"],
    });
    const { viem } = client(
      fakeRpcNode(() => ({ error: { code: 3, message: "execution reverted", data } })),
    );
    const failure = await viem
      .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BaseError);
    const reverted = (failure as BaseError).walk(
      (cause) => cause instanceof ContractFunctionRevertedError,
    );
    expect(reverted).toMatchObject({ reason: "insufficient balance" });
    expect(causeChain(failure).some((cause) => cause instanceof RpcRequestError)).toBe(true);
  });

  it("carries the failover's fault as the cause of viem's error", async () => {
    const { viem } = client("refuse");
    const failure = await viem.getBlockNumber().catch((error: unknown) => error);
    const fault = causeChain(failure).find((cause) => cause instanceof BinferenceError);
    expect(fault).toMatchObject({ code: "chain.rpc_down", retryable: true });
  });

  it("refuses params that are not plain json before anything is sent", async () => {
    const { viem, http } = client(fakeRpcNode(() => ({ result: "0x0" })));
    const failure = await viem
      .request({ method: "eth_getBalance", params: [holder, 1n as unknown as "latest"] })
      .catch((error: unknown) => error);
    const fault = causeChain(failure).find((cause) => cause instanceof BinferenceError);
    expect(fault).toMatchObject({ code: "chain.rpc_bad_request" });
    expect(http.requests()).toHaveLength(0);
  });
});
