import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcFailover, RpcReply } from "@binference/plugin-sdk/evm";
import type { Address, Hex } from "viem";
import { z } from "zod";

/** Where the venue reads Genius.fun's contracts: the chain's RPC failover and the call's signal. */
export interface GeniusRead {
  readonly rpc: RpcFailover;
  readonly signal: AbortSignal;
}

/** One `eth_call` at the latest block: the contract and its calldata. */
export interface ReadCallData {
  readonly to: Address;
  readonly data: Hex;
}

const hexResultSchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value),
  { message: "An eth_call result is hex bytes." },
);

/** The fault of a Genius.fun contract that could not be read, or answered outside its shape. */
export function unreadable(problem: string): BinferenceError {
  return new BinferenceError({
    code: "geniusfun.read_failed",
    message: `Genius.fun's contracts could not be read: ${problem}`,
  });
}

async function call(read: GeniusRead, asked: ReadCallData): Promise<RpcReply<Hex>> {
  return read.rpc.request({
    method: "eth_call",
    params: [{ to: asked.to, data: asked.data }, "latest"],
    result: hexResultSchema,
    signal: read.signal,
  });
}

/**
 * Reads one call at the latest block and decodes its answer. A revert, or an answer outside the
 * shape `decode` reads, is a fault (`geniusfun.read_failed`) naming `what`. Rejects when no node
 * answers, and with the signal's reason once it aborts.
 */
export async function readCall<T>(
  read: GeniusRead,
  asked: ReadCallData & { readonly what: string },
  decode: (data: Hex) => T,
): Promise<T> {
  const reply = await call(read, asked);
  if (reply.kind === "error") {
    throw unreadable(`${asked.what} reverted.`);
  }
  try {
    return decode(reply.value);
  } catch {
    throw unreadable(`${asked.what} is not in its shape.`);
  }
}

/**
 * Reads one call that may fairly fail, such as a view a contract may not have: a revert, or an
 * answer outside the shape `decode` reads, is `undefined`. Rejects when no node answers, and with
 * the signal's reason once it aborts.
 */
export async function readOptional<T>(
  read: GeniusRead,
  asked: ReadCallData,
  decode: (data: Hex) => T,
): Promise<T | undefined> {
  const reply = await call(read, asked);
  if (reply.kind === "error") {
    return undefined;
  }
  try {
    return decode(reply.value);
  } catch {
    return undefined;
  }
}
