import { assetRefSchema } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import { encodeAbiParameters, keccak256, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { heldBalances } from "./held-balances.js";

const url = "https://node.invalid/";
const holder = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const live = { signal: new AbortController().signal };

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const usdtAsset = assetRefSchema.parse(`${chain.ref}/erc20:${usdt}`);
// The fake token keeps its balances in a Solidity mapping at index 1.
const usdtSlot = keccak256(
  encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 1n]),
);

function setup(answer: () => FakeRpcAnswer) {
  const http = createFakeRpcHttp({ [url]: fakeRpcNode(answer) });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { http, rpc };
}

// The marker of candidate 1 (the mapping at index 1), as the probe sets it.
const markerOfSlot1 = pad(toHex((1n << 254n) + 1n));
const found = (): FakeRpcAnswer => ({
  result: [
    {
      number: "0x1",
      calls: [{ status: "0x1", gasUsed: "0x1", returnData: markerOfSlot1, logs: [] }],
    },
  ],
});
const computed = (): FakeRpcAnswer => ({
  result: [
    { number: "0x1", calls: [{ status: "0x1", gasUsed: "0x1", returnData: pad("0x7"), logs: [] }] },
  ],
});

describe("heldBalances", () => {
  it("sets the native coin's balance without asking the node", async () => {
    const { http, rpc } = setup(found);
    const amounts = [{ asset: chain.nativeAsset, base: 5n }];
    await expect(heldBalances(rpc, { chain, holder, amounts, ...live })).resolves.toStrictEqual({
      balances: [{ address: holder, balanceWei: 5n }],
      storage: [],
    });
    expect(http.requests()).toHaveLength(0);
  });

  it("sets a token's balance in the slot the probe finds", async () => {
    const { rpc } = setup(found);
    const amounts = [{ asset: usdtAsset, base: 78n * 10n ** 18n }];
    await expect(heldBalances(rpc, { chain, holder, amounts, ...live })).resolves.toStrictEqual({
      balances: [],
      storage: [{ address: usdt, slot: usdtSlot, value: toHex(78n * 10n ** 18n, { size: 32 }) }],
    });
  });

  it("leaves a token whose slot it cannot find at the holder's balance on the chain", async () => {
    const { rpc } = setup(computed);
    const amounts = [{ asset: usdtAsset, base: 1n }];
    await expect(heldBalances(rpc, { chain, holder, amounts, ...live })).resolves.toStrictEqual({
      balances: [],
      storage: [],
    });
  });

  it.each([
    ["another chain's token", `eip155:1/erc20:${usdt}`],
    ["an asset that is not an ERC-20 token", `${chain.ref}/erc721:${usdt}`],
  ])("refuses %s before it asks the node", async (_case, asset) => {
    const { http, rpc } = setup(found);
    const amounts = [{ asset: assetRefSchema.parse(asset), base: 1n }];
    await expect(heldBalances(rpc, { chain, holder, amounts, ...live })).rejects.toMatchObject({
      code: "chain.bad_balances",
      details: { asset },
    });
    expect(http.requests()).toHaveLength(0);
  });
});
