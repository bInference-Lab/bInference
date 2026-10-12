import type { HttpRequest, HttpResponse } from "@binference/core";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  multicall3Abi,
  toHex,
} from "viem";
import { z } from "zod";
import { hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { type FakeRpcAnswer, fakeRpcNode } from "./fake-rpc-http.js";

/** One read call a fake node answers, and the block it reads. */
export interface FakeRead {
  readonly target: Address;
  readonly callData: Hex;
  /** The block the batch named; `latest` when it named none. */
  readonly block: bigint | "latest";
}

/**
 * What a fake EVM node answers one read call: return data, `undefined` for a revert, or `burn`
 * for a call that burns its gas and fails the whole `eth_call`.
 */
export type FakeReadAnswer = (read: FakeRead) => Hex | undefined | "burn";

/** A batch of reads a fake node received through Multicall3. */
interface FakeBatch {
  readonly block: bigint | "latest";
  readonly calls: number;
}

/** A fake EVM node: its head, the batches it answered, and its endpoint for a fake Http. */
export interface FakeEvmNode {
  readonly endpoint: (request: HttpRequest) => HttpResponse;
  /** Moves the head to a new block, which `eth_blockNumber` answers from now on. */
  setHead(head: bigint): void;
  /** Every Multicall3 batch the node answered, oldest first. */
  batches(): readonly FakeBatch[];
  /** The gas each `eth_call` asked for, oldest first; `undefined` for one that named none. */
  gasLimits(): readonly (bigint | undefined)[];
}

function stringParam(params: readonly JsonValue[], index: number): string | undefined {
  const value = params[index];
  return typeof value === "string" ? value : undefined;
}

const noData: Hex = "0x";

const callSchema = z.looseObject({
  to: z.string(),
  data: hexSchema,
  gas: quantitySchema.optional(),
});

function callOf(
  params: readonly JsonValue[],
): { readonly to: string; readonly data: Hex; readonly gas?: bigint | undefined } | undefined {
  const call = callSchema.safeParse(params[0]);
  return call.success ? call.data : undefined;
}

// The node's answer to a batch: each call's return data, or "out of gas" when a call burns its gas.
function aggregateAnswer(answers: readonly (Hex | undefined | "burn")[]): FakeRpcAnswer {
  if (answers.includes("burn")) {
    return { error: { code: -32_000, message: "out of gas" } };
  }
  const results = answers.map((returnData) =>
    returnData === undefined || returnData === "burn"
      ? { success: false, returnData: noData }
      : { success: true, returnData },
  );
  return {
    result: encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: results,
    }),
  };
}

/**
 * Creates a fake EVM node for tests: it answers `eth_blockNumber` with its head, and `eth_call`
 * of Multicall3's `aggregate3` at `multicall` by answering each call with `answer`; a block above
 * its head is "header not found", as geth answers, and a batch with a call that burns its gas is
 * "out of gas". Any other request is JSON-RPC's
 * method-not-found.
 */
export function createFakeEvmNode(options: {
  readonly multicall: Address;
  readonly head: bigint;
  readonly answer: FakeReadAnswer;
}): FakeEvmNode {
  let head = options.head;
  const batches: FakeBatch[] = [];
  const gasLimits: (bigint | undefined)[] = [];
  const aggregate = (params: readonly JsonValue[]): FakeRpcAnswer => {
    const call = callOf(params);
    const tag = stringParam(params, 1);
    gasLimits.push(call?.gas);
    if (call === undefined || getAddress(call.to) !== options.multicall) {
      return { error: { code: -32_000, message: "execution reverted" } };
    }
    const block = tag === undefined || tag === "latest" ? "latest" : BigInt(tag);
    // A node answers a block it has not imported as geth does.
    if (block !== "latest" && block > head) {
      return { error: { code: -32_000, message: "header not found" } };
    }
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
    const reads = decoded.functionName === "aggregate3" ? decoded.args[0] : [];
    batches.push({ block, calls: reads.length });
    const answers = reads.map(({ target, callData }) =>
      options.answer({ target: getAddress(target), callData, block }),
    );
    return aggregateAnswer(answers);
  };
  return {
    endpoint: fakeRpcNode(({ method, params }) => {
      if (method === "eth_blockNumber") {
        return { result: toHex(head) };
      }
      return method === "eth_call"
        ? aggregate(params)
        : { error: { code: -32_601, message: "the method does not exist" } };
    }),
    setHead: (next) => {
      head = next;
    },
    batches: () => [...batches],
    gasLimits: () => [...gasLimits],
  };
}
