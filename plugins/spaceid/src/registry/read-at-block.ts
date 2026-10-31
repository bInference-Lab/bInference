import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { type CodeKind, codeKindOf } from "./code-kind.js";

/** Where a resolution reads: the chain's RPC failover, one block, and the call's signal. */
export interface BlockRead {
  readonly rpc: RpcFailover;
  /** The block every read of one resolution takes, as a hex quantity. */
  readonly block: Hex;
  readonly signal: AbortSignal;
}

/** The latest block: its number, which pins every read, and its time, which expiries meet. */
export interface LatestBlock {
  readonly number: Hex;
  /** Seconds since the epoch. */
  readonly timestamp: bigint;
}

const hexSchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value),
  { message: "An answer is hex bytes." },
);
const quantitySchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value),
  { message: "A quantity is hex without leading zeros." },
);
const blockSchema = z.object({ number: quantitySchema, timestamp: quantitySchema });

/** A fault of a read: the node answered outside the shape SPACE ID's contracts declare. */
export function unreadable(problem: string): BinferenceError {
  return new BinferenceError({
    code: "spaceid.read_failed",
    message: `SPACE ID's contracts could not be read: ${problem}`,
  });
}

/**
 * Reads the latest block's number and time. Rejects when no node answers, a node answers a block
 * that is not one (`spaceid.read_failed`), and with the signal's reason once it aborts.
 */
export async function readLatestBlock(rpc: RpcFailover, signal: AbortSignal): Promise<LatestBlock> {
  const reply = await rpc.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
    result: blockSchema.nullable(),
    signal,
    atHead: true,
  });
  if (reply.kind === "error" || reply.value === null) {
    throw unreadable("the latest block could not be read.");
  }
  return { number: reply.value.number, timestamp: BigInt(reply.value.timestamp) };
}

/**
 * The answer of an `eth_call` at the read's block, or `undefined` when the call reverted, as a
 * resolver without the function does. Rejects when no node answers, and with the signal's reason
 * once it aborts.
 */
export async function callAtBlock(
  read: BlockRead,
  call: { readonly to: Address; readonly data: Hex },
): Promise<Hex | undefined> {
  const reply = await read.rpc.request({
    method: "eth_call",
    params: [{ to: call.to, data: call.data }, read.block],
    result: hexSchema,
    signal: read.signal,
  });
  return reply.kind === "error" ? undefined : reply.value;
}

/**
 * What the account's code at the read's block says about it (see {@link codeKindOf}). Rejects as
 * {@link callAtBlock} does.
 */
export async function readCodeKind(read: BlockRead, account: Address): Promise<CodeKind> {
  const reply = await read.rpc.request({
    method: "eth_getCode",
    params: [account, read.block],
    result: hexSchema,
    signal: read.signal,
  });
  if (reply.kind === "error") {
    throw unreadable("an account's code could not be read.");
  }
  return codeKindOf(reply.value);
}
