import { BinferenceError } from "@binference/core";
import { type Address, type Hex, toHex } from "viem";
import { z } from "zod";
import { type ChainLog, chainLogSchema } from "../leaders/chain-block.schema.js";
import { isQueryTooLarge } from "../rpc/node-fault.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** What a log query is asked with. */
export interface LogReader {
  readonly rpc: RpcFailover;
  /** How long one endpoint may take; the failover's own timeout when absent. */
  readonly timeoutMs?: number;
  readonly signal: AbortSignal;
}

/**
 * One log query: blocks `from` to `to`, or the one block of `blockHash`, read by hash so no node
 * answers another; the contracts that wrote them, any when absent; and the topics, each position
 * matching any of its values, `null` for any.
 */
export interface LogFilter {
  readonly from: bigint;
  readonly to: bigint;
  readonly blockHash?: Hex;
  readonly address?: readonly Address[];
  readonly topics: readonly (string | readonly string[] | null)[];
}

const logsSchema = z.array(chainLogSchema);

/**
 * Asks one `eth_getLogs` query. An answer an endpoint refuses as too large is `too_large`, so the
 * caller asks again for less; any other error is a `chain.rpc_error` fault. Rejects with the
 * signal's reason once it aborts.
 */
export async function askLogs(
  reader: LogReader,
  filter: LogFilter,
): Promise<readonly ChainLog[] | "too_large"> {
  const blocks =
    filter.blockHash === undefined
      ? { fromBlock: toHex(filter.from), toBlock: toHex(filter.to) }
      : { blockHash: filter.blockHash };
  const method = "eth_getLogs";
  const reply = await reader.rpc.request({
    method,
    params: [
      {
        ...blocks,
        ...(filter.address === undefined ? {} : { address: filter.address }),
        topics: filter.topics,
      },
    ],
    result: logsSchema,
    signal: reader.signal,
    ...(filter.blockHash === undefined ? {} : { atHead: true }),
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
  });
  if (reply.kind === "result") {
    return reply.value;
  }
  if (isQueryTooLarge(reply)) {
    return "too_large";
  }
  throw new BinferenceError({
    code: "chain.rpc_error",
    message: `${method} failed on ${reply.endpoint}: ${reply.message}`,
    details: { method, endpoint: reply.endpoint, rpcCode: reply.code },
  });
}
