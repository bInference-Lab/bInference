import { accountRefSchema, type TxDraft } from "@binference/chain";
import { txSimulatorContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { type Address, type Hex, pad, toEventSelector, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encodeEvmDraft } from "../drafts/evm-draft.js";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import {
  createFakeRpcHttp,
  type FakeRpcAnswer,
  type FakeRpcRequest,
  fakeRpcNode,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import { createEvmTxSimulator } from "./create-evm-tx-simulator.js";

const url = "https://node.invalid/";
const user = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const nativeEmitter = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const transferTopic = toEventSelector("Transfer(address,address,uint256)");
const approvalTopic = toEventSelector("Approval(address,address,uint256)");

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const account = (address: Address) => accountRefSchema.parse(`${chain.ref}:${address}`);
const word = (value: bigint): Hex => pad(toHex(value));
const live = { signal: new AbortController().signal };

const swap = encodeEvmDraft({
  from: account(user),
  to: account(router),
  value: 10n ** 17n,
  data: "0x7ff36ab5",
});
const approve = encodeEvmDraft({ from: account(user), to: account(usdt), value: 0n, data: "0x" });
const paid = {
  from: account(user),
  to: account(router),
  amount: { asset: chain.nativeAsset, base: 10n ** 17n },
};

const requestSchema = z.tuple([
  z.object({ blockStateCalls: z.tuple([z.object({ calls: z.array(z.unknown()) })]) }),
  z.literal("latest"),
]);

// The node runs the first call with a native transfer and an approval; any later call reverts.
function answer(request: FakeRpcRequest): FakeRpcAnswer {
  const [{ blockStateCalls }] = requestSchema.parse(request.params);
  const logs: readonly JsonValue[] = [
    {
      address: nativeEmitter,
      topics: [transferTopic, pad(user), pad(router)],
      data: word(10n ** 17n),
    },
    {
      address: usdt.toLowerCase(),
      topics: [approvalTopic, pad(user), pad(router)],
      data: word(7n),
    },
  ];
  const calls = blockStateCalls[0].calls.map((_, index) =>
    index === 0
      ? { status: "0x1", gasUsed: "0x1dbfc", returnData: "0x", logs: [...logs] }
      : { status: "0x0", gasUsed: "0x5208", returnData: "0x", logs: [] },
  );
  return { result: [{ number: "0x78489c5", calls }] };
}

function setup() {
  const http = createFakeRpcHttp({ [url]: fakeRpcNode(answer) });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { http, simulator: createEvmTxSimulator({ rpc, chain }) };
}

describe("createEvmTxSimulator", () => {
  it.each(
    txSimulatorContract({
      create: () => ({
        simulator: setup().simulator,
        moving: { drafts: [swap], transfer: paid },
        reverting: [swap, approve],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("simulates each draft's call in order and reads what it moved and allowed", async () => {
    const { http, simulator } = setup();
    await expect(simulator.simulate([swap], live)).resolves.toStrictEqual([
      {
        status: "success",
        gasUsed: 121_852n,
        transfers: [paid],
        approvals: [
          {
            owner: account(user),
            spender: account(router),
            amount: { asset: `${chain.ref}/erc20:${usdt}`, base: 7n },
          },
        ],
      },
    ]);
    const [sent] = http.requests();
    expect(readFakeRpcRequest(sent?.body).params[0]).toMatchObject({
      blockStateCalls: [{ calls: [{ from: user, to: router, value: "0x16345785d8a0000" }] }],
      validation: false,
    });
  });

  it.each([
    ["a draft of another chain", { ...swap, chain: "eip155:1", from: `eip155:1:${user}` }],
    ["a draft the EVM family cannot read", { ...swap, payload: "0x01" }],
  ] as const)("refuses %s as a fault, asking no node", async (_name, draft) => {
    const { http, simulator } = setup();
    await expect(simulator.simulate([draft as TxDraft], live)).rejects.toMatchObject({
      code: "chain.bad_draft",
    });
    expect(http.requests()).toHaveLength(0);
  });
});
