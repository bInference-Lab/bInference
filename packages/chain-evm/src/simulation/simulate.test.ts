import { createManualClock } from "@binference/core/testing";
import { type Address, type Hex, pad, toEventSelector, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import {
  createFakeRpcHttp,
  type FakeRpcAnswer,
  fakeRpcNode,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import { type SimulationRequest, simulate } from "./simulate.js";

const url = "https://node.invalid/";
const user = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const pair = "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE";
const wbnb = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const nft = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const nativeEmitter = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const transfer = toEventSelector("Transfer(address,address,uint256)");
const approval = toEventSelector("Approval(address,address,uint256)");

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const topic = (address: Address): Hex => pad(address);
const word = (value: bigint): Hex => pad(toHex(value));

function log(address: string, topics: readonly Hex[], data: Hex): JsonValue {
  return { address, topics: [...topics], data, logIndex: "0x0", removed: false };
}

const swapLogs: readonly JsonValue[] = [
  log(nativeEmitter, [transfer, topic(user), topic(router)], word(10n ** 17n)),
  log(wbnb, [transfer, topic(router), topic(pair)], word(10n ** 17n)),
  log(usdt, [transfer, topic(pair), topic(user)], word(78n * 10n ** 18n)),
  log(usdt, [approval, topic(user), topic(router)], word(5n)),
  log(nft, [transfer, topic(user), topic(pair), word(7n)], "0x"),
  log(usdt, [transfer, `0xff${topic(user).slice(4)}`, topic(pair)], word(1n)),
  log(usdt, [transfer, topic(user), topic(pair)], "0x01"),
];

function answered(calls: readonly JsonValue[]): FakeRpcAnswer {
  return { result: [{ number: "0x78489c5", hash: "0x01", calls: [...calls] }] };
}

function setup(answer: FakeRpcAnswer) {
  const http = createFakeRpcHttp({ [url]: fakeRpcNode(() => answer) });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { http, rpc };
}

const request: SimulationRequest = {
  chain,
  calls: [{ from: user, to: router, value: 10n ** 17n, data: "0x7ff36ab5" }],
  balances: [{ address: user, balanceWei: 10n ** 18n }],
  signal: new AbortController().signal,
};

const amount = (asset: string, base: bigint) => ({ asset, base });

describe("simulate", () => {
  it("asks for one block with transfer traces and no validation", async () => {
    const { http, rpc } = setup(
      answered([{ status: "0x1", gasUsed: "0x1", returnData: "0x", logs: [] }]),
    );
    await simulate(rpc, request);
    const [sent] = http.requests();
    expect(readFakeRpcRequest(sent?.body)).toMatchObject({
      method: "eth_simulateV1",
      params: [
        {
          blockStateCalls: [
            {
              stateOverrides: { [user]: { balance: "0xde0b6b3a7640000" } },
              calls: [{ from: user, to: router, value: "0x16345785d8a0000", data: "0x7ff36ab5" }],
            },
          ],
          traceTransfers: true,
          validation: false,
        },
        "latest",
      ],
    });
  });

  it("reads native and token transfers and approvals into CAIP ids and amounts", async () => {
    const { rpc } = setup(
      answered([{ status: "0x1", gasUsed: "0x1dbfc", returnData: "0x", logs: [...swapLogs] }]),
    );
    const simulation = await simulate(rpc, request);
    expect(simulation.blockNumber).toBe(126_126_533n);
    const [call] = simulation.calls;
    expect(call?.status).toBe("success");
    expect(call?.gasUsed).toBe(121_852n);
    expect(call?.transfers).toStrictEqual([
      {
        from: `eip155:56:${user}`,
        to: `eip155:56:${router}`,
        amount: amount("eip155:56/slip44:714", 10n ** 17n),
      },
      {
        from: `eip155:56:${router}`,
        to: `eip155:56:${pair}`,
        amount: amount(`eip155:56/erc20:${wbnb}`, 10n ** 17n),
      },
      {
        from: `eip155:56:${pair}`,
        to: `eip155:56:${user}`,
        amount: amount(`eip155:56/erc20:${usdt}`, 78n * 10n ** 18n),
      },
    ]);
    expect(call?.approvals).toStrictEqual([
      {
        owner: `eip155:56:${user}`,
        spender: `eip155:56:${router}`,
        amount: amount(`eip155:56/erc20:${usdt}`, 5n),
      },
    ]);
    expect(call?.logs).toHaveLength(swapLogs.length);
  });

  it("keeps a reverted call's revert data and reports no transfers", async () => {
    const { rpc } = setup(
      answered([{ status: "0x0", gasUsed: "0x5208", returnData: "0x08c379a0", logs: [] }]),
    );
    const simulation = await simulate(rpc, request);
    expect(simulation.calls).toStrictEqual([
      {
        status: "reverted",
        gasUsed: 21_000n,
        returnData: "0x08c379a0",
        transfers: [],
        approvals: [],
        logs: [],
      },
    ]);
  });

  it("names the node's answer when it refuses the simulation", async () => {
    const { rpc } = setup({ error: { code: -32_602, message: "invalid block state calls" } });
    await expect(simulate(rpc, request)).rejects.toMatchObject({
      code: "chain.simulation_failed",
    });
  });

  it("refuses an answer for another number of calls", async () => {
    const { rpc } = setup(answered([]));
    await expect(simulate(rpc, request)).rejects.toMatchObject({
      code: "chain.simulation_failed",
    });
  });

  it("sets one override per account: its native balance and the storage slots it changes", async () => {
    const { http, rpc } = setup(
      answered([{ status: "0x1", gasUsed: "0x1", returnData: "0x", logs: [] }]),
    );
    const slot = word(3n);
    await simulate(rpc, {
      ...request,
      storage: [
        { address: usdt, slot, value: word(9n) },
        { address: user, slot, value: word(1n) },
      ],
    });
    const [sent] = http.requests();
    expect(readFakeRpcRequest(sent?.body).params[0]).toMatchObject({
      blockStateCalls: [
        {
          stateOverrides: {
            [user]: { balance: "0xde0b6b3a7640000", stateDiff: { [slot]: word(1n) } },
            [usdt]: { stateDiff: { [slot]: word(9n) } },
          },
        },
      ],
    });
  });

  it("simulates calls without balance overrides", async () => {
    const { http, rpc } = setup(
      answered([{ status: "0x1", gasUsed: "0x1", returnData: "0x", logs: [] }]),
    );
    await simulate(rpc, { chain, calls: request.calls, signal: request.signal });
    const [sent] = http.requests();
    expect(readFakeRpcRequest(sent?.body).params[0]).toMatchObject({
      blockStateCalls: [{ stateOverrides: {} }],
    });
  });
});
