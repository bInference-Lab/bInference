import { BinferenceError } from "@binference/plugin-sdk";
import { readAggregate, type RpcFailover } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  parseAbi,
  toHex,
} from "viem";
import { z } from "zod";

/** Where one read of StakeHub runs: the chain's RPC failover, Multicall3, one block, a signal. */
export interface BlockRead {
  readonly rpc: RpcFailover;
  readonly multicall: Address;
  /** The block every call of the read takes. */
  readonly block: bigint;
  /** That block's time, seconds since the epoch. */
  readonly time: bigint;
  readonly signal: AbortSignal;
}

/** One read call: the contract, its calldata, and how its answer reads. */
export interface HubRead<T> {
  readonly target: Address;
  readonly callData: Hex;
  /** Reads the answer; throws on an answer outside the function's shape. */
  readonly decode: (data: Hex) => T;
}

// Multicall3 batches of at most this many calls: a validator's reads are seven, and a block of
// every validator's would ask a node for more gas than some allow in one call.
const batchSize = 200;
const parallelBatches = 4;

/** A fault of a read: StakeHub or a credit contract answered outside its shape, or reverted. */
export function unreadable(problem: string): BinferenceError {
  return new BinferenceError({
    code: "stakehub.read_failed",
    message: `StakeHub could not be read: ${problem}`,
  });
}

// The block and its time, as Multicall3 reads them (multicall3.com's ABI).
const headAbi = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
const headCalls = (["getBlockNumber", "getCurrentBlockTimestamp"] as const).map((functionName) => ({
  functionName,
  callData: encodeFunctionData({ abi: headAbi, functionName }),
}));

/**
 * The latest block's number and time, read through Multicall3 in one call, which every call of
 * one read then takes. Rejects when no node answers (`chain.rpc_down`), when Multicall3 answers
 * outside its shape (`stakehub.read_failed`), and with the signal's reason once it aborts.
 */
export async function latestBlock(
  rpc: RpcFailover,
  read: { readonly multicall: Address; readonly signal: AbortSignal },
): Promise<{ readonly block: bigint; readonly time: bigint }> {
  read.signal.throwIfAborted();
  const calls = headCalls.map(({ callData }) => ({ target: read.multicall, callData }));
  const answers = await readAggregate(rpc, { ...read, calls });
  const [block, time] = headCalls.map(({ functionName }, index) =>
    headValue(functionName, answers[index]),
  );
  if (block === undefined || time === undefined) {
    throw unreadable("Multicall3 answered the latest block outside its shape.");
  }
  return { block, time };
}

function headValue(
  functionName: (typeof headCalls)[number]["functionName"],
  data: Hex | undefined,
): bigint | undefined {
  try {
    return data === undefined
      ? undefined
      : decodeFunctionResult({ abi: headAbi, functionName, data });
  } catch {
    return undefined;
  }
}

function decoded<T>(read: HubRead<T>, data: Hex | undefined): T | undefined {
  if (data === undefined) {
    return undefined;
  }
  try {
    return read.decode(data);
  } catch {
    throw unreadable("a call answered outside its function's shape.");
  }
}

// One batch at the read's block: a node named it its latest moments before, so a node that
// has not imported it yet answers "not yet" and is not counted against.
async function readBatch<T>(
  at: BlockRead,
  batch: readonly HubRead<T>[],
): Promise<readonly (Hex | undefined)[]> {
  return readAggregate(at.rpc, {
    multicall: at.multicall,
    calls: batch.map(({ target, callData }) => ({ target, callData })),
    block: at.block,
    signal: at.signal,
    atHead: true,
  });
}

/**
 * Asks every read at the read's block through Multicall3, in batches of at most 200 calls, at most
 * four batches at once, and answers each in order: `undefined` for one that reverted, which a
 * caller treats as the contract does. An answer outside its shape is `stakehub.read_failed`; no
 * node answering is `chain.rpc_down`.
 */
export async function readEach<T>(
  at: BlockRead,
  reads: readonly HubRead<T>[],
): Promise<readonly (T | undefined)[]> {
  const batches: (readonly HubRead<T>[])[] = [];
  for (let start = 0; start < reads.length; start += batchSize) {
    batches.push(reads.slice(start, start + batchSize));
  }
  const answers: (readonly (Hex | undefined)[])[] = [];
  for (let start = 0; start < batches.length; start += parallelBatches) {
    const group = batches.slice(start, start + parallelBatches);
    // oxlint-disable-next-line eslint/no-await-in-loop -- at most four batches run at once
    answers.push(...(await Promise.all(group.map(async (batch) => readBatch(at, batch)))));
  }
  return answers.flat().map((data, index) => {
    const read = reads[index];
    return read === undefined ? undefined : decoded(read, data);
  });
}

const codeSchema = z.templateLiteral(["0x", z.string().regex(/^(?:[0-9a-fA-F]{2})*$/)]);

/**
 * Whether the account holds code at the read's block. Rejects when no node answers, when one
 * answers no code (`stakehub.read_failed`), and with the signal's reason once it aborts.
 */
export async function holdsCode(at: BlockRead, account: Address): Promise<boolean> {
  const reply = await at.rpc.request({
    method: "eth_getCode",
    params: [account, toHex(at.block)],
    result: codeSchema,
    signal: at.signal,
    atHead: true,
  });
  if (reply.kind === "error") {
    throw unreadable("an account's code could not be read.");
  }
  return reply.value !== "0x";
}

/** A value a read must give: a revert of a call StakeHub always answers is a fault. */
export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw unreadable(`${what} reverted.`);
  }
  return value;
}
