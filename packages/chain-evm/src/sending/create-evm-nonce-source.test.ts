import { accountRefSchema } from "@binference/chain";
import { nonceSourceContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeRpcHttp, fakeRpcNode, readFakeRpcRequest } from "../testing/fake-rpc-http.js";
import { createEvmNonceSource } from "./create-evm-nonce-source.js";

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const url = "https://node.invalid/";
const known = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const account = accountRefSchema.parse(`eip155:56:${known}`);
const unseen = accountRefSchema.parse("eip155:56:0x10ED43C718714eb63d5aA57B78B54704E256024E");
const live = () => ({ signal: new AbortController().signal });

function sourceOf(count = "0x7") {
  const http = createFakeRpcHttp({
    [url]: fakeRpcNode(({ params }) => ({ result: params[0] === known ? count : "0x0" })),
  });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { http, source: createEvmNonceSource({ rpc, chain }) };
}

describe("the EVM nonce source", () => {
  it.each(
    nonceSourceContract({
      create: async () =>
        await Promise.resolve({
          source: sourceOf().source,
          known: { account, next: 7 },
          unseen,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("counts the account's pending transactions on its chain", async () => {
    const { source, http } = sourceOf();
    await source.next(account, live());
    const [request] = http.requests();
    expect(readFakeRpcRequest(request?.body)).toMatchObject({
      method: "eth_getTransactionCount",
      params: [known, "pending"],
    });
  });

  it("refuses an account of another chain, and a count past a safe integer", async () => {
    const other = accountRefSchema.parse(`eip155:1:${known}`);
    await expect(sourceOf().source.next(other, live())).rejects.toMatchObject({
      code: "chain.unknown_chain",
    });
    await expect(sourceOf("0x20000000000000").source.next(account, live())).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
  });
});
