import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address, Hex } from "viem";
import { z } from "zod";

/** Where the venue reads Brew's contracts: the chain's RPC failover and the call's signal. */
export interface BrewRead {
  readonly rpc: RpcFailover;
  readonly signal: AbortSignal;
}

const callResultSchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value),
  { message: "An eth_call answers hex bytes." },
);

/**
 * Reads one view of Brew's contracts at the latest block and decodes its answer. A revert, or an
 * answer outside the shape `decode` reads, is a fault (`brew.read_failed`) naming `what`. Rejects
 * when no node answers, and with the signal's reason once it aborts.
 */
export async function readBrew<T>(
  read: BrewRead,
  call: { readonly to: Address; readonly data: Hex; readonly what: string },
  decode: (data: Hex) => T,
): Promise<T> {
  const reply = await read.rpc.request({
    method: "eth_call",
    params: [{ to: call.to, data: call.data }, "latest"],
    result: callResultSchema,
    signal: read.signal,
  });
  const decoded = reply.kind === "error" ? undefined : decodeSafely(decode, reply.value);
  if (decoded === undefined) {
    throw new BinferenceError({
      code: "brew.read_failed",
      message: `Brew's contracts could not be read: ${call.what} failed or is not in its shape.`,
    });
  }
  return decoded.value;
}

function decodeSafely<T>(decode: (data: Hex) => T, data: Hex): { readonly value: T } | undefined {
  try {
    return { value: decode(data) };
  } catch {
    return undefined;
  }
}
