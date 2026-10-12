import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcFailover, RpcReply } from "@binference/plugin-sdk/evm";
import type { Address, Hex } from "viem";
import { z } from "zod";
import {
  isTokenNotFound,
  type PortalTrade,
  quoteCallData,
  quotedOut,
  stateCallData,
  stateOf,
} from "./portal-calls.js";
import type { TokenState } from "./token-state.js";

/** Where the venue reads the Portal: the chain's RPC failover, the Portal, and the call's signal. */
export interface PortalRead {
  readonly rpc: RpcFailover;
  readonly portal: Address;
  readonly signal: AbortSignal;
}

const hexResultSchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value),
  { message: "An eth_call result is hex bytes." },
);

function unreadable(problem: string): BinferenceError {
  return new BinferenceError({
    code: "flap.read_failed",
    message: `Flap's Portal could not be read: ${problem}`,
  });
}

async function call(read: PortalRead, data: Hex): Promise<RpcReply<Hex>> {
  return read.rpc.request({
    method: "eth_call",
    params: [{ to: read.portal, data }, "latest"],
    result: hexResultSchema,
    signal: read.signal,
  });
}

// The Portal's own answer for a token it never launched: `TokenNotFound` naming that token.
function isNotFound(reply: RpcReply<Hex>, token: Address): boolean {
  const data = reply.kind === "error" ? hexResultSchema.safeParse(reply.data) : undefined;
  return data?.success === true && isTokenNotFound(data.data, token);
}

/**
 * Reads a token's state from the Portal at the latest block. A token Flap never launched is
 * `undefined`, from the Portal's own `TokenNotFound`. Any other revert or an answer outside the
 * state's shape is a fault (`flap.read_failed`), so a token whose place is in doubt never counts as
 * off its curve. Rejects when no node answers, and with the signal's reason once it aborts.
 */
export async function readTokenState(
  read: PortalRead,
  token: Address,
): Promise<TokenState | undefined> {
  const reply = await call(read, stateCallData(token));
  if (reply.kind === "error") {
    if (isNotFound(reply, token)) {
      return undefined;
    }
    throw unreadable("the token's state read reverted.");
  }
  try {
    return stateOf(reply.value);
  } catch {
    throw unreadable("the token's state is not in the shape the Portal declares.");
  }
}

/**
 * What the Portal's `quoteExactInput` answers for a trade at the latest block, in base units of
 * the output. A quote the Portal reverts is `undefined`: it cannot trade that pair. An answer
 * outside the call's shape is a fault (`flap.read_failed`). Rejects when no node answers, and with
 * the signal's reason once it aborts.
 */
export async function quoteOnPortal(
  read: PortalRead,
  trade: PortalTrade,
): Promise<bigint | undefined> {
  const reply = await call(read, quoteCallData(trade));
  if (reply.kind === "error") {
    return undefined;
  }
  try {
    return quotedOut(reply.value);
  } catch {
    throw unreadable("its quote is not a number.");
  }
}
