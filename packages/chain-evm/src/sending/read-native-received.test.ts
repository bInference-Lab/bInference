import type { AccountRef } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import { getAddress, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { createFakeRpcHttp, type FakeRpcAnswer, fakeRpcNode } from "../testing/fake-rpc-http.js";
import { readNativeReceived } from "./read-native-received.js";

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const nodeUrl = "https://node.invalid/";
const tracerUrl = "https://tracer.invalid/";
const wallet = getAddress("0x00000000000000000000000000000000000000a1");
const router = getAddress("0x00000000000000000000000000000000000000b2");
const stranger = getAddress("0x00000000000000000000000000000000000000c3");
const account = `${chain.ref}:${wallet}` as AccountRef;
const live = () => ({ signal: new AbortController().signal });
const hashOf = (byte: string) => `0x${byte.repeat(32)}`;
const approval = hashOf("a1");
const sale = hashOf("a2");
const failed = hashOf("a3");
const foreign = hashOf("a4");
const pruned: FakeRpcAnswer = {
  error: { code: -32_000, message: "historical state 0x77 is not available" },
};

// Block 0x30 holds three of the wallet's transactions and a stranger's: an approval, a sale whose
// inner call paid the wallet 900 wei, and a reverted call whose 40 wei value stayed home.
const fees = new Map<JsonValue | undefined, { readonly status: string; readonly gasUsed: string }>([
  [approval, { status: "0x1", gasUsed: "0xa" }],
  [sale, { status: "0x1", gasUsed: "0x14" }],
  [failed, { status: "0x0", gasUsed: "0x5" }],
]);
const feePerGas = 3n;
const paid = (10n + 20n + 5n) * feePerGas;
const blockAnswer: FakeRpcAnswer = {
  result: {
    transactions: [
      { hash: approval, from: wallet, value: "0x0" },
      { hash: foreign, from: stranger, value: "0x9" },
      { hash: sale, from: wallet, value: "0x0" },
      { hash: failed, from: wallet, value: "0x28" },
    ],
  },
};

function nodeAnswer(balances: ReadonlyMap<JsonValue | undefined, FakeRpcAnswer>) {
  return (method: string, params: readonly JsonValue[]): FakeRpcAnswer => {
    const [first, second] = params;
    if (method === "eth_getBlockByNumber") {
      return first === "0x30" ? blockAnswer : { result: null };
    }
    if (method === "eth_getTransactionReceipt") {
      const fee = fees.get(first);
      return { result: { ...fee, effectiveGasPrice: toHex(feePerGas) } };
    }
    return balances.get(second) ?? pruned;
  };
}

// The sale's trace: the router paid the wallet 900 wei, a stranger 7, and a call that failed
// would have paid the wallet 50; the approval's trace paid nothing.
function tracerAnswer(method: string, params: readonly JsonValue[]): FakeRpcAnswer {
  const [hash] = params;
  const calls =
    hash === sale
      ? [
          { to: router, calls: [{ to: wallet, value: "0x384" }] },
          { to: stranger, value: "0x7" },
          { to: wallet, value: "0x32", error: "execution reverted" },
        ]
      : [];
  return method === "debug_traceTransaction"
    ? { result: { to: router, value: "0x0", calls } }
    : { error: { code: -32_601, message: "method not found" } };
}

function failoverOf(
  url: string,
  answer: (method: string, params: readonly JsonValue[]) => FakeRpcAnswer,
): RpcFailover {
  const http = createFakeRpcHttp({
    [url]: fakeRpcNode((request) => answer(request.method, request.params)),
  });
  return createRpcFailover({
    endpoints: [{ name: url, url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
}

const before = 10n ** 18n;
const kept = new Map<JsonValue | undefined, FakeRpcAnswer>([
  ["0x2f", { result: toHex(before) }],
  ["0x30", { result: toHex(before - paid + 900n) }],
]);
const prunedBefore = new Map<JsonValue | undefined, FakeRpcAnswer>([
  ["0x30", { result: toHex(before - paid + 900n) }],
]);

describe("the native coin a wallet received in a block", () => {
  it("is the balance change with the fees and run values of its own transactions counted back", async () => {
    const source = { rpc: failoverOf(nodeUrl, nodeAnswer(kept)), chain };
    await expect(
      readNativeReceived(source, { account, block: 0x30n }, live().signal),
    ).resolves.toStrictEqual({
      ok: true,
      value: 900n,
    });
  });

  it("counts a balance that fell more than the wallet paid as nothing received", async () => {
    const drained = new Map(kept).set("0x30", { result: toHex(before - paid - 1n) });
    const source = { rpc: failoverOf(nodeUrl, nodeAnswer(drained)), chain };
    await expect(
      readNativeReceived(source, { account, block: 0x30n }, live().signal),
    ).resolves.toStrictEqual({
      ok: true,
      value: 0n,
    });
  });

  it("reads the tracer's call frames once the node pruned the state before the block", async () => {
    const source = {
      rpc: failoverOf(nodeUrl, nodeAnswer(prunedBefore)),
      chain,
      tracer: failoverOf(tracerUrl, tracerAnswer),
    };
    await expect(
      readNativeReceived(source, { account, block: 0x30n }, live().signal),
    ).resolves.toStrictEqual({
      ok: true,
      value: 900n,
    });
  });

  it("is state_gone once the state is pruned and no tracer, or a pruned one, can say", async () => {
    const rpc = failoverOf(nodeUrl, nodeAnswer(prunedBefore));
    const prunedTracer = failoverOf(tracerUrl, () => pruned);
    const gone = { ok: false, error: "state_gone" };
    await expect(
      readNativeReceived({ rpc, chain }, { account, block: 0x30n }, live().signal),
    ).resolves.toStrictEqual(gone);
    const traced = { rpc, chain, tracer: prunedTracer };
    await expect(
      readNativeReceived(traced, { account, block: 0x30n }, live().signal),
    ).resolves.toStrictEqual(gone);
  });

  it("fails as a fault for a block no node holds, or a node that is down", async () => {
    const rpc = failoverOf(nodeUrl, nodeAnswer(kept));
    await expect(
      readNativeReceived({ rpc, chain }, { account, block: 0x31n }, live().signal),
    ).rejects.toMatchObject({
      code: "chain.block_missing",
    });
    const failing: FakeRpcAnswer = { status: 500, body: "" };
    const down = failoverOf(
      nodeUrl,
      nodeAnswer(
        new Map([
          ["0x2f", failing],
          ["0x30", failing],
        ]),
      ),
    );
    await expect(
      readNativeReceived({ rpc: down, chain }, { account, block: 0x30n }, live().signal),
    ).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
    const tracerDown = failoverOf(tracerUrl, () => ({ status: 500, body: "" }));
    const traced = {
      rpc: failoverOf(nodeUrl, nodeAnswer(prunedBefore)),
      chain,
      tracer: tracerDown,
    };
    await expect(
      readNativeReceived(traced, { account, block: 0x30n }, live().signal),
    ).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
  });
});
