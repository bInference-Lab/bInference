import { createManualClock } from "@binference/core/testing";
import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  pad,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import {
  createFakeRpcHttp,
  type FakeRpcAnswer,
  type FakeRpcRequest,
  fakeRpcNode,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import { balanceSlotCandidates, erc7201Location, findBalanceSlot } from "./balance-slot.js";

const url = "https://node.invalid/";
const holder = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const token = "0x55d398326f99059fF775485246999027B3197955";
const live = { signal: new AbortController().signal };

// Where a Solidity mapping at storage index `index` keeps `holder`'s entry.
function solidityMappingSlot(index: bigint): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, index]),
  );
}

// Where OpenZeppelin's upgradeable ERC-20 keeps `holder`'s balance.
const namespacedSlot = keccak256(
  encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [holder, erc7201Location("openzeppelin.storage.ERC20")],
  ),
);

// A node that answers every request the same way.
const answering = (reply: FakeRpcAnswer) => (): FakeRpcAnswer => reply;

function balanceOfAnswer(status: Hex, returnData: Hex): FakeRpcAnswer {
  return { result: [{ number: "0x1", calls: [{ status, gasUsed: "0x1", returnData, logs: [] }] }] };
}

const requestSchema = z.tuple([
  z.object({
    blockStateCalls: z.tuple([
      z.object({
        stateOverrides: z.record(
          z.string(),
          z.object({ stateDiff: z.record(z.string(), z.string()) }),
        ),
      }),
    ]),
  }),
  z.literal("latest"),
]);

// A token that answers balanceOf with whatever its override put in `slot`.
function tokenReading(slot: Hex): (request: FakeRpcRequest) => FakeRpcAnswer {
  return (request) => {
    const [{ blockStateCalls }] = requestSchema.parse(request.params);
    const stateDiff = blockStateCalls[0].stateOverrides[token]?.stateDiff ?? {};
    const value = stateDiff[slot] ?? pad("0x0");
    return {
      result: [
        { number: "0x1", calls: [{ status: "0x1", gasUsed: "0x1", returnData: value, logs: [] }] },
      ],
    };
  };
}

function setup(answer: (request: FakeRpcRequest) => FakeRpcAnswer) {
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

describe("erc7201Location", () => {
  it("matches EIP-7201's example and OpenZeppelin's ERC-20 storage location", () => {
    expect(erc7201Location("example.main")).toBe(
      "0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500",
    );
    expect(erc7201Location("openzeppelin.storage.ERC20")).toBe(
      "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00",
    );
  });
});

describe("balanceSlotCandidates", () => {
  it("names Solidity and Vyper mappings at the first 200 indexes and the namespaced storage", () => {
    const candidates = balanceSlotCandidates(holder);
    const vyperAt3 = keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [3n, holder]),
    );
    expect(candidates).toHaveLength(401);
    expect(candidates[0]).toBe(solidityMappingSlot(0n));
    expect(candidates[199]).toBe(solidityMappingSlot(199n));
    expect(candidates).toContain(vyperAt3);
    expect(candidates.at(-1)).toBe(namespacedSlot);
  });
});

describe("findBalanceSlot", () => {
  it("finds the slot whose marker balanceOf reads, in one call", async () => {
    const slot = solidityMappingSlot(51n);
    const { http, rpc } = setup(tokenReading(slot));
    await expect(findBalanceSlot(rpc, { token, holder, ...live })).resolves.toBe(slot);
    const [sent] = http.requests();
    expect(http.requests()).toHaveLength(1);
    expect(readFakeRpcRequest(sent?.body)).toMatchObject({
      method: "eth_simulateV1",
      params: [
        {
          blockStateCalls: [
            {
              calls: [
                {
                  from: holder,
                  to: token,
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [holder],
                  }),
                },
              ],
            },
          ],
          validation: false,
        },
        "latest",
      ],
    });
  });

  it("finds OpenZeppelin's namespaced balances", async () => {
    const { rpc } = setup(tokenReading(namespacedSlot));
    await expect(findBalanceSlot(rpc, { token, holder, ...live })).resolves.toBe(namespacedSlot);
  });

  it("finds no slot for a token that computes its balances", async () => {
    const { rpc } = setup(answering(balanceOfAnswer("0x1", pad(toHex(12_345n)))));
    await expect(findBalanceSlot(rpc, { token, holder, ...live })).resolves.toBeUndefined();
  });

  it.each([
    ["reverts", "0x0", "0x"],
    ["answers less than one word", "0x1", "0x01"],
  ] as const)("finds no slot when balanceOf %s", async (_case, status, returnData) => {
    const { rpc } = setup(answering(balanceOfAnswer(status, returnData)));
    await expect(findBalanceSlot(rpc, { token, holder, ...live })).resolves.toBeUndefined();
  });

  it("finds no slot when the node refuses the probe as a call", async () => {
    const { rpc } = setup(answering({ error: { code: -32_602, message: "invalid params" } }));
    await expect(findBalanceSlot(rpc, { token, holder, ...live })).resolves.toBeUndefined();
  });

  it("rejects like the simulation when no node answers", async () => {
    const { rpc } = setup(answering({ error: { code: -32_601, message: "method not found" } }));
    await expect(findBalanceSlot(rpc, { token, holder, ...live })).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
  });
});
